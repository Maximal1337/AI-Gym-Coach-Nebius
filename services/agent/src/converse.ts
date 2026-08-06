import { ChatOpenRouter } from "@langchain/openrouter";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { CoachProfile, Exercise, SetLog } from "@gymcoach/shared";
import { suggestTargets, type Targets } from "./progression.js";
import { buildSystemPrompt, buildConversationPrompt, buildConfirmPrompt } from "./prompt.js";
import { composeWithLlm, costCents, type LlmUsage } from "./llm.js";
import { llmConfig } from "./config.js";
import { buildTurnTools, emptyOutcome, type RemainingExerciseCandidate } from "./tools.js";

/**
 * Free-text mid-workout turn (GYM-61/67, revised for §20's tool-calling
 * rework — see the System Design doc for why the original single
 * JSON-blob call got replaced): a real multi-step agent loop instead of
 * one structured-output guess. The model calls tools (logCompletedSets,
 * stopExerciseEarly, deferCurrentExercise, switchToExercise,
 * substituteExercise, saveNote), sees each one's real result, and only
 * composes its final reply once it has nothing left to decide — which is
 * what makes the reply and the resulting state structurally unable to
 * disagree, unlike the old single-shot JSON output.
 */

export interface ConversationInput {
  profile: CoachProfile;
  exercise: Exercise;
  lastLogs: SetLog[];
  notes: string[];
  userMessage: string;
  recentHistory: Array<{ from: "coach" | "me"; text: string }>;
  /** §20: real structured progress on this exercise so far this session. */
  thisSessionLogs: SetLog[];
  nextExercise: Exercise | null;
  nextLastLogs: SetLog[];
  nextNotes: string[];
  /** §20: other fresh/deferred exercises the model may look up and switch to. */
  remainingExercises: RemainingExerciseCandidate[];
  /** The exercise (if any) most recently logged this session before the current one — see correctPreviousExerciseSet. */
  previousExercise: Exercise | null;
  previousExerciseLogs: SetLog[];
}

export interface ConversationOutput {
  message: string;
  usage: LlmUsage;
  degraded: boolean;
  /** This turn's newly reported sets only — the caller already knows what was logged before. */
  loggedSets: Array<{ weightKg: number; reps: number }>;
  stoppedEarly: boolean;
  stopReason: string | null;
  /** True when deferCurrentExercise was called (nothing logged, set aside). */
  deferred: boolean;
  deferReason: string | null;
  /** Caller must still validate against real DB state before trusting this. */
  switchToExerciseId: string | null;
  substituteExercise: {
    name: string;
    sets: number;
    repRange: string;
    restSec: number;
    equipmentType: Exercise["equipmentType"] | null;
  } | null;
  noteToSave: { text: string; general: boolean } | null;
  /** Caller must re-validate the setNo against real set_logs rows before trusting this. */
  correctedSet: { setNo: number; weightKg: number | null; reps: number | null } | null;
  /** Caller resolves which real coach_notes row this applies to — the agent has no note ids. */
  correctedNote: { newText: string } | null;
  /** Caller must re-validate the setNo against the PREVIOUS exercise's real set_logs rows before trusting this. */
  correctedPreviousExerciseSet: { exerciseId: string; setNo: number; weightKg: number | null; reps: number | null } | null;
  /**
   * The target for whichever exercise is actually next — the default, or
   * whatever switchToExercise/substituteExercise resolved to. Returned
   * separately from `message` because the LLM composes prose and can
   * occasionally mistranscribe a number — the client renders these, not
   * numbers parsed back out of the text.
   */
  nextSuggestedWeightKg: number | null;
  nextTargetReps: number[] | null;
  /** Per-set weight for the next exercise — see progression.ts; nextSuggestedWeightKg alone can't express a set that carried its own track. */
  nextTargetWeights: number[] | null;
}

const MAX_TOOL_ITERATIONS = 6;

/**
 * Genuine few-shot exchange (not prose describing the rule) for three
 * failure modes prose-only instructions weren't reliable for on their own:
 * a pure note/reminder request getting logged as if it were a completed
 * report (§18.C), narrating a switch that never actually succeeded (§20,
 * bug 3), and a bare "yes" answering a READINESS question ("ready to
 * start?") getting logged as a completed set instead of just acknowledged
 * — the same ambiguous-bare-confirmation family as the first bug, but a
 * distinct real production case, so it earns its own example rather than
 * assuming the first one generalizes. Tool-calling fixes *whether the
 * final state agrees with the reply*, not whether the model's initial
 * read of an ambiguous
 * message is right — so all three guardrails still need their own real
 * demonstration, not just prose.
 *
 * One full example set PER LANGUAGE, not a single fixed one — a Hebrew
 * few-shot example was found to pull English/Arabic replies back toward
 * Hebrew even with "reply in English" stated explicitly in the system
 * prompt (the exact bug this fixed: every free-text reply after the
 * first came back in Hebrew regardless of the selected language, since
 * this was the one prompt component still hardcoded to one language).
 */
type FewShotLang = "en" | "he" | "ar";

function isFewShotLang(v: string): v is FewShotLang {
  return v === "en" || v === "he" || v === "ar";
}

const FEW_SHOT_BY_LANG: Record<FewShotLang, BaseMessageLike[]> = {
  en: [
    [
      "human",
      'EXAMPLE (not the real conversation, just showing you the correct shape) — user message: "remind me to push all the way through with the weight" — no numbers, purely a reminder request, even though a target was already suggested earlier. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_note_1", name: "saveNote", args: { text: "Push all the way through with the weight", general: false } },
      ],
    }),
    new ToolMessage("Noted for future sessions.", "example_note_1", "saveNote"),
    new AIMessage("Got it, noted — I'll remind you next time! 💪"),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: the current exercise is a leg curl machine, nothing logged for it yet, and an incline chest press was deferred earlier this session. User message: "the incline chest press machine just freed up" — a STATEMENT, not a direct command, but it clearly means "let\'s do that now instead." Decide what to do (remember: listAvailableExercises first, then switchToExercise with the real id it gives you — never narrate a switch that didn\'t actually succeed).',
    ],
    new AIMessage({
      content: "",
      tool_calls: [{ id: "example_switch_1", name: "listAvailableExercises", args: {} }],
    }),
    new ToolMessage(
      'id: ex_incline_chest_press — "Incline Chest Press (Dumbbell)" (previously deferred), 3 sets of 8-10 reps',
      "example_switch_1",
      "listAvailableExercises",
    ),
    new AIMessage({
      content: "",
      tool_calls: [{ id: "example_switch_2", name: "switchToExercise", args: { exerciseId: "ex_incline_chest_press" } }],
    }),
    new ToolMessage(
      "Switching to Incline Chest Press (Dumbbell) (coming back to a previously deferred exercise).\nStructure: 3 work sets, 8-10 reps, rest 120s.\nComputed target for today: 21kg, sets of 10, 10, 10 reps.",
      "example_switch_2",
      "switchToExercise",
    ),
    new AIMessage("Great, let's take the opportunity and go back to the exercise we wanted to do earlier: Incline Chest Press (Dumbbell). Your target: 21kg for 10, 10, 10 reps 🎯"),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: your own last message asked "Ready to start?" (a READINESS question, not a request to report back after the set), with a target already given: 60kg for 8, 8, 8 reps. User message: "Yes" — a bare confirmation, but it answers the readiness question, it does not report a completed set. Decide what to do.',
    ],
    new AIMessage("Let's go! 💪 Report back once you've finished your first set."),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: the current exercise is Leg Press (nothing logged for it yet this session). The PREVIOUS exercise this session was Goblet Squat, logged as set 1: 12kg x 8, set 2: 12kg x 8, set 3: 12kg x 8. User message: "In goblet squats i did 12kg x 8/7/7" — this names a DIFFERENT exercise (Goblet Squat, not the current Leg Press) and corrects sets 2 and 3 from 8 reps to 7; set 1 is unchanged. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_prevfix_1", name: "correctPreviousExerciseSet", args: { setNo: 2, weightKg: 12, reps: 7 } },
        { id: "example_prevfix_2", name: "correctPreviousExerciseSet", args: { setNo: 3, weightKg: 12, reps: 7 } },
      ],
    }),
    new ToolMessage("Corrected Goblet Squat set 2: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_1", "correctPreviousExerciseSet"),
    new ToolMessage("Corrected Goblet Squat set 3: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_2", "correctPreviousExerciseSet"),
    new AIMessage("Got it, fixed your Goblet Squat numbers — 12kg for 8, 7, and 7 reps. Since you're on Leg Press now, whenever you're ready let me know your numbers for that! 💪"),
    [
      "human",
      'EXAMPLE — same bug, but a GENERIC reference instead of a named exercise: the current exercise is Seated Leg Curl (nothing logged for it yet this session). The PREVIOUS exercise this session was Leg Press, logged as set 1: 12kg x 8, set 2: 12kg x 8, set 3: 12kg x 8. User message: "wait, the previous exercise was actually 8/7/7, not 8/8/8" — no exercise named, but "the previous exercise" plainly means Leg Press, not the current Seated Leg Curl. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_prevfix_3", name: "correctPreviousExerciseSet", args: { setNo: 2, weightKg: 12, reps: 7 } },
        { id: "example_prevfix_4", name: "correctPreviousExerciseSet", args: { setNo: 3, weightKg: 12, reps: 7 } },
      ],
    }),
    new ToolMessage("Corrected Leg Press set 2: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_3", "correctPreviousExerciseSet"),
    new ToolMessage("Corrected Leg Press set 3: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_4", "correctPreviousExerciseSet"),
    new AIMessage("Got it, fixed your Leg Press numbers — 12kg for 8, 7, and 7 reps. Whenever you're ready, let me know your numbers on Seated Leg Curl! 💪"),
  ],
  he: [
    [
      "human",
      'EXAMPLE (not the real conversation, just showing you the correct shape) — user message: "תזכיר לי ללחוץ עד הסוף עם המשקולת" — no numbers, purely a reminder request, even though a target was already suggested earlier. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_note_1", name: "saveNote", args: { text: "ללחוץ עד הסוף עם המשקולת", general: false } },
      ],
    }),
    new ToolMessage("Noted for future sessions.", "example_note_1", "saveNote"),
    new AIMessage("רשמתי לי את זה — אזכיר לך בפעם הבאה! 💪"),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: the current exercise is a leg curl machine, nothing logged for it yet, and an incline chest press was deferred earlier this session. User message: "המכונה של חזה בשיפוע התפנתה" ("the incline chest machine freed up") — a STATEMENT, not a direct command, but it clearly means "let\'s do that now instead." Decide what to do (remember: listAvailableExercises first, then switchToExercise with the real id it gives you — never narrate a switch that didn\'t actually succeed).',
    ],
    new AIMessage({
      content: "",
      tool_calls: [{ id: "example_switch_1", name: "listAvailableExercises", args: {} }],
    }),
    new ToolMessage(
      'id: ex_incline_chest_press — "לחיצת חזה בשיפוע חיובי עם משקולות" (previously deferred), 3 sets of 8-10 reps',
      "example_switch_1",
      "listAvailableExercises",
    ),
    new AIMessage({
      content: "",
      tool_calls: [{ id: "example_switch_2", name: "switchToExercise", args: { exerciseId: "ex_incline_chest_press" } }],
    }),
    new ToolMessage(
      "Switching to לחיצת חזה בשיפוע חיובי עם משקולות (coming back to a previously deferred exercise).\nStructure: 3 work sets, 8-10 reps, rest 120s.\nComputed target for today: 21kg, sets of 10, 10, 10 reps.",
      "example_switch_2",
      "switchToExercise",
    ),
    new AIMessage("מעולה! אז בוא ננצל את ההזדמנות ונחזור לתרגיל הקודם שרצינו לעשות: לחיצת חזה בשיפוע חיובי עם משקולות. היעד שלך: 21 קילו ל-10, 10, 10 חזרות 🎯"),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: your own last message asked "מוכן להתחיל?" ("ready to start?" — a READINESS question, not a request to report back after the set), with a target already given: 60 ק"ג ל-8, 8, 8 חזרות. User message: "כן" ("yes") — a bare confirmation, but it answers the readiness question, it does not report a completed set. Decide what to do.',
    ],
    new AIMessage("בוא נתחיל! 💪 תעדכן אותי אחרי שתסיים את הסט הראשון."),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: the current exercise is לחיצת רגליים (Leg Press, nothing logged for it yet this session). The PREVIOUS exercise this session was סקוואט גובלט (Goblet Squat), logged as set 1: 12kg x 8, set 2: 12kg x 8, set 3: 12kg x 8. User message: "בסקוואט גובלט עשיתי 12 קילו על 8/7/7" — this names a DIFFERENT exercise (Goblet Squat, not the current Leg Press) and corrects sets 2 and 3 from 8 reps to 7; set 1 is unchanged. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_prevfix_1", name: "correctPreviousExerciseSet", args: { setNo: 2, weightKg: 12, reps: 7 } },
        { id: "example_prevfix_2", name: "correctPreviousExerciseSet", args: { setNo: 3, weightKg: 12, reps: 7 } },
      ],
    }),
    new ToolMessage("Corrected סקוואט גובלט set 2: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_1", "correctPreviousExerciseSet"),
    new ToolMessage("Corrected סקוואט גובלט set 3: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_2", "correctPreviousExerciseSet"),
    new AIMessage("קיבלתי, תיקנתי את המספרים של סקוואט גובלט — 12 קילו ל-8, 7, ו-7 חזרות. עכשיו כשאתה בלחיצת רגליים, תעדכן אותי במספרים שלך שם כשתהיה מוכן! 💪"),
    [
      "human",
      'EXAMPLE — same bug, but a GENERIC reference instead of a named exercise: the current exercise is כפיפת רגליים בישיבה (Seated Leg Curl, nothing logged for it yet this session). The PREVIOUS exercise this session was לחיצת רגליים (Leg Press), logged as set 1: 12kg x 8, set 2: 12kg x 8, set 3: 12kg x 8. User message: "רגע, בתרגיל הקודם עשיתי בעצם 8/7/7, לא 8/8/8" ("wait, in the previous exercise I actually did 8/7/7, not 8/8/8") — no exercise named, but "the previous exercise" plainly means Leg Press, not the current Seated Leg Curl. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_prevfix_3", name: "correctPreviousExerciseSet", args: { setNo: 2, weightKg: 12, reps: 7 } },
        { id: "example_prevfix_4", name: "correctPreviousExerciseSet", args: { setNo: 3, weightKg: 12, reps: 7 } },
      ],
    }),
    new ToolMessage("Corrected לחיצת רגליים set 2: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_3", "correctPreviousExerciseSet"),
    new ToolMessage("Corrected לחיצת רגליים set 3: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_4", "correctPreviousExerciseSet"),
    new AIMessage("קיבלתי, תיקנתי את המספרים של לחיצת רגליים — 12 קילו ל-8, 7, ו-7 חזרות. כשתהיה מוכן, תעדכן אותי במספרים שלך בכפיפת רגליים בישיבה! 💪"),
  ],
  ar: [
    [
      "human",
      'EXAMPLE (not the real conversation, just showing you the correct shape) — user message: "ذكرني أن أدفع حتى النهاية مع الوزن" — no numbers, purely a reminder request, even though a target was already suggested earlier. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_note_1", name: "saveNote", args: { text: "الدفع حتى النهاية مع الوزن", general: false } },
      ],
    }),
    new ToolMessage("Noted for future sessions.", "example_note_1", "saveNote"),
    new AIMessage("تم، لاحظت ذلك — سأذكرك في المرة القادمة! 💪"),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: the current exercise is a leg curl machine, nothing logged for it yet, and an incline chest press was deferred earlier this session. User message: "جهاز ضغط الصدر المائل تفرغ للتو" ("the incline chest machine just freed up") — a STATEMENT, not a direct command, but it clearly means "let\'s do that now instead." Decide what to do (remember: listAvailableExercises first, then switchToExercise with the real id it gives you — never narrate a switch that didn\'t actually succeed).',
    ],
    new AIMessage({
      content: "",
      tool_calls: [{ id: "example_switch_1", name: "listAvailableExercises", args: {} }],
    }),
    new ToolMessage(
      'id: ex_incline_chest_press — "ضغط صدر مائل بالدمبل" (previously deferred), 3 sets of 8-10 reps',
      "example_switch_1",
      "listAvailableExercises",
    ),
    new AIMessage({
      content: "",
      tool_calls: [{ id: "example_switch_2", name: "switchToExercise", args: { exerciseId: "ex_incline_chest_press" } }],
    }),
    new ToolMessage(
      "Switching to ضغط صدر مائل بالدمبل (coming back to a previously deferred exercise).\nStructure: 3 work sets, 8-10 reps, rest 120s.\nComputed target for today: 21kg, sets of 10, 10, 10 reps.",
      "example_switch_2",
      "switchToExercise",
    ),
    new AIMessage("ممتاز! لنغتنم الفرصة ونعود للتمرين الذي أردنا القيام به سابقًا: ضغط صدر مائل بالدمبل. هدفك: 21 كغ لـ 10، 10، 10 تكرارات 🎯"),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: your own last message asked "هل أنت جاهز للبدء؟" ("ready to start?" — a READINESS question, not a request to report back after the set), with a target already given: 60 كغ لـ 8، 8، 8 تكرارات. User message: "نعم" ("yes") — a bare confirmation, but it answers the readiness question, it does not report a completed set. Decide what to do.',
    ],
    new AIMessage("هيا بنا! 💪 أخبرني بعد أن تنهي مجموعتك الأولى."),
    [
      "human",
      'EXAMPLE — a real production bug this fixes: the current exercise is ضغط الأرجل (Leg Press, nothing logged for it yet this session). The PREVIOUS exercise this session was قرفصاء الجوبلت (Goblet Squat), logged as set 1: 12kg x 8, set 2: 12kg x 8, set 3: 12kg x 8. User message: "في قرفصاء الجوبلت عملت 12 كغ على 8/7/7" — this names a DIFFERENT exercise (Goblet Squat, not the current Leg Press) and corrects sets 2 and 3 from 8 reps to 7; set 1 is unchanged. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_prevfix_1", name: "correctPreviousExerciseSet", args: { setNo: 2, weightKg: 12, reps: 7 } },
        { id: "example_prevfix_2", name: "correctPreviousExerciseSet", args: { setNo: 3, weightKg: 12, reps: 7 } },
      ],
    }),
    new ToolMessage("Corrected قرفصاء الجوبلت set 2: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_1", "correctPreviousExerciseSet"),
    new ToolMessage("Corrected قرفصاء الجوبلت set 3: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_2", "correctPreviousExerciseSet"),
    new AIMessage("تم، صححت أرقام قرفصاء الجوبلت — 12 كغ لـ 8، 7، و7 تكرارات. بما أنك الآن في ضغط الأرجل، أخبرني بأرقامك هناك عندما تكون جاهزًا! 💪"),
    [
      "human",
      'EXAMPLE — same bug, but a GENERIC reference instead of a named exercise: the current exercise is تمرين مطرقة الرجل بالجلوس (Seated Leg Curl, nothing logged for it yet this session). The PREVIOUS exercise this session was ضغط الأرجل (Leg Press), logged as set 1: 12kg x 8, set 2: 12kg x 8, set 3: 12kg x 8. User message: "لحظة، في التمرين السابق عملت فعليًا 8/7/7 مش 8/8/8" ("wait, in the previous exercise I actually did 8/7/7, not 8/8/8") — no exercise named, but "the previous exercise" plainly means Leg Press, not the current Seated Leg Curl. Decide what to do.',
    ],
    new AIMessage({
      content: "",
      tool_calls: [
        { id: "example_prevfix_3", name: "correctPreviousExerciseSet", args: { setNo: 2, weightKg: 12, reps: 7 } },
        { id: "example_prevfix_4", name: "correctPreviousExerciseSet", args: { setNo: 3, weightKg: 12, reps: 7 } },
      ],
    }),
    new ToolMessage("Corrected ضغط الأرجل set 2: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_3", "correctPreviousExerciseSet"),
    new ToolMessage("Corrected ضغط الأرجل set 3: was 12kg × 8 reps, now 12kg × 7 reps.", "example_prevfix_4", "correctPreviousExerciseSet"),
    new AIMessage("تم، صححت أرقام ضغط الأرجل — 12 كغ لـ 8، 7، و7 تكرارات. أخبرني بأرقامك في تمرين مطرقة الرجل بالجلوس عندما تكون جاهزًا! 💪"),
  ],
};

function fewShotMessagesFor(language: string): BaseMessageLike[] {
  return FEW_SHOT_BY_LANG[isFewShotLang(language) ? language : "en"];
}

export async function runConversationTurn(input: ConversationInput): Promise<ConversationOutput> {
  const currentTargets = suggestTargets(input.exercise, input.lastLogs);
  const defaultNextTargets: Targets | null = input.nextExercise
    ? suggestTargets(input.nextExercise, input.nextLastLogs)
    : null;

  if (!process.env.OPENROUTER_API_KEY) {
    // No API key (local dev): a safe no-op so the pipeline stays
    // exercisable without spending a token or losing the user's report.
    return {
      message: "Got it — recorded. Let's keep going!",
      usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 },
      degraded: true,
      loggedSets: [],
      stoppedEarly: false,
      stopReason: null,
      deferred: false,
      deferReason: null,
      switchToExerciseId: null,
      substituteExercise: null,
      noteToSave: null,
      correctedSet: null,
      correctedNote: null,
      correctedPreviousExerciseSet: null,
      nextSuggestedWeightKg: null,
      nextTargetReps: null,
      nextTargetWeights: null,
    };
  }

  const systemPrompt = buildSystemPrompt(input.profile);
  const turnPrompt = buildConversationPrompt({
    exercise: input.exercise,
    lastLogs: input.lastLogs,
    notes: input.notes,
    userMessage: input.userMessage,
    recentHistory: input.recentHistory,
    currentTargets,
    thisSessionLogs: input.thisSessionLogs,
    nextExercise: input.nextExercise,
    nextTargets: defaultNextTargets,
    nextLastLogs: input.nextLastLogs,
    previousExercise: input.previousExercise,
    previousExerciseLogs: input.previousExerciseLogs,
  });

  const outcome = emptyOutcome();
  const tools = buildTurnTools(
    {
      exercise: input.exercise,
      thisSessionLogs: input.thisSessionLogs,
      remainingExercises: input.remainingExercises,
      previousExercise: input.previousExercise,
      previousExerciseLogs: input.previousExerciseLogs,
    },
    outcome,
  );
  const toolsByName = new Map<string, (typeof tools)[number]>(tools.map((t) => [t.name, t]));

  const model = new ChatOpenRouter({
    model: llmConfig.model,
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens: llmConfig.maxOutputTokens,
    temperature: llmConfig.temperature,
    siteName: "Notch",
  }).bindTools(tools);

  const messages: BaseMessageLike[] = [
    ["system", systemPrompt],
    ...fewShotMessagesFor(input.profile.language),
    ["human", turnPrompt],
  ];

  let tokensInput = 0;
  let tokensOutput = 0;
  let finalMessage = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await model.invoke(messages);
    tokensInput += res.usage_metadata?.input_tokens ?? 0;
    tokensOutput += res.usage_metadata?.output_tokens ?? 0;

    if (!res.tool_calls || res.tool_calls.length === 0) {
      finalMessage = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      break;
    }

    messages.push(res);
    for (const call of res.tool_calls) {
      const toolFn = toolsByName.get(call.name);
      let resultText: string;
      if (!toolFn) {
        resultText = `Unknown tool: ${call.name}`;
      } else {
        try {
          resultText = (await toolFn.invoke(call.args)) as string;
        } catch (e) {
          resultText = `Invalid arguments — ${(e as Error).message}. Try again with corrected arguments.`;
        }
      }
      messages.push(new ToolMessage(resultText, call.id ?? "", call.name));
    }

    // Ran out of iterations without a final text reply — compose a safe
    // fallback rather than returning nothing to the user.
    if (i === MAX_TOOL_ITERATIONS - 1) {
      finalMessage = "Got it — recorded. Let's keep going!";
    }
  }

  // Whichever exercise is actually next: an explicit switch/substitute
  // override, or the default already computed above.
  let nextSuggestedWeightKg = defaultNextTargets?.suggestedWeightKg ?? null;
  let nextTargetReps = defaultNextTargets?.targetReps ?? null;
  let nextTargetWeights = defaultNextTargets?.targetWeights ?? null;
  if (outcome.switchTarget) {
    const t = suggestTargets(outcome.switchTarget.exercise, outcome.switchTarget.lastLogs);
    nextSuggestedWeightKg = t.suggestedWeightKg;
    nextTargetReps = t.targetReps;
    nextTargetWeights = t.targetWeights;
  } else if (outcome.substituteExercise) {
    // Brand-new exercise, no history — always baseline, nothing to suggest.
    nextSuggestedWeightKg = null;
    nextTargetReps = null;
    nextTargetWeights = null;
  }

  return {
    message: finalMessage,
    usage: { tokensInput, tokensOutput, costCents: costCents(tokensInput, tokensOutput) },
    degraded: false,
    loggedSets: outcome.loggedSets,
    stoppedEarly: outcome.stoppedEarly,
    stopReason: outcome.stopReason,
    deferred: outcome.deferred,
    deferReason: outcome.deferReason,
    switchToExerciseId: outcome.switchToExerciseId,
    substituteExercise: outcome.substituteExercise,
    noteToSave: outcome.noteToSave,
    correctedSet: outcome.correctedSet,
    correctedNote: outcome.correctedNote,
    correctedPreviousExerciseSet: outcome.correctedPreviousExerciseSet,
    nextSuggestedWeightKg,
    nextTargetReps,
    nextTargetWeights,
  };
}

export interface ConfirmInput {
  profile: CoachProfile;
  exercise: Exercise;
  confirmedSets: Array<{ weightKg: number; reps: number }>;
  notes: string[];
  nextExercise: Exercise | null;
  nextLastLogs: SetLog[];
  nextNotes: string[];
  /** §20: nextExercise is being resurfaced from the deferred pool. */
  isRevisit?: boolean;
}

export interface ConfirmOutput {
  message: string;
  usage: LlmUsage;
  degraded: boolean;
  nextSuggestedWeightKg: number | null;
  nextTargetReps: number[] | null;
  nextTargetWeights: number[] | null;
}

/**
 * Generative-UI confirm action (System Design §19, revised): the sets
 * are already final — no graph, no extraction, just compose the reply
 * the same way session-start composes an exercise intro
 * (composeWithLlm + plain-text output), so quality matches the
 * free-text path. Chosen over a canned template after direct feedback
 * that a flat sentence read as a noticeably worse response than a
 * typed report gets. Unaffected by the §20 tool-calling rework — there's
 * no ambiguity here for a tool loop to help resolve.
 */
export async function runConfirmTurn(input: ConfirmInput): Promise<ConfirmOutput> {
  const nextTargets: Targets | null = input.nextExercise
    ? suggestTargets(input.nextExercise, input.nextLastLogs)
    : null;

  const systemPrompt = buildSystemPrompt(input.profile);
  const turnPrompt = buildConfirmPrompt({
    exercise: input.exercise,
    confirmedSets: input.confirmedSets,
    notes: input.notes,
    nextExercise: input.nextExercise,
    nextTargets,
    nextLastLogs: input.nextLastLogs,
    nextNotes: input.nextNotes,
    isRevisit: input.isRevisit ?? false,
  });

  const reply = await composeWithLlm(systemPrompt, turnPrompt);
  if (reply) {
    return {
      message: reply.message,
      usage: reply.usage,
      degraded: false,
      nextSuggestedWeightKg: nextTargets?.suggestedWeightKg ?? null,
      nextTargetReps: nextTargets?.targetReps ?? null,
      nextTargetWeights: nextTargets?.targetWeights ?? null,
    };
  }

  // No API key (local dev): a safe no-op so the pipeline stays
  // exercisable without spending a token or losing the confirmed sets.
  const weightKg = input.confirmedSets[0]?.weightKg ?? 0;
  const reps = input.confirmedSets.map((s) => s.reps).join("/");
  return {
    message: `Logged ${weightKg}kg x ${reps}. Let's keep going!`,
    usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 },
    degraded: true,
    nextSuggestedWeightKg: nextTargets?.suggestedWeightKg ?? null,
    nextTargetReps: nextTargets?.targetReps ?? null,
    nextTargetWeights: nextTargets?.targetWeights ?? null,
  };
}
