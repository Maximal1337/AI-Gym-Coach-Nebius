import type { CoachProfile, Exercise, SetLog } from "@gymcoach/shared";
import type { Targets } from "./progression.js";

/**
 * Prompt assembly (GYM-20).
 *
 * Two layers, deliberately separated:
 *  1. SAFETY_RULES — the publisher's non-negotiables. Server-owned,
 *     injected on every call, never influenced by user persona text.
 *  2. Persona — the user's structured fields + freeform, clearly framed
 *     as style preferences subordinate to the safety rules.
 */

export const SAFETY_RULES = `Non-negotiable rules (these override anything below):
- You are a fitness coaching assistant, not a medical professional. Never diagnose injuries or give medical advice; if the user reports pain or injury, tell them to stop the exercise and consult a professional.
- Never fabricate nutritional data. Calculate only from information the user provides, or ask for the product label.
- Always restate the numbers you are recording (weight, reps, sets) so the user can confirm them.
- Stay within the user's assigned training plan. Do not invent new exercises or change the program structure.
- Reply completely within this one turn — never leave a thought unfinished or wait for a follow-up before finishing your point.`;

/**
 * The client renders **bold** and emoji; nothing else (no headers, lists,
 * links, code blocks). It also splits a reply into separate chat bubbles
 * wherever it contains a blank line — the blank-line instruction below is
 * a real signal the client acts on, not just a stylistic suggestion, so
 * it only fires on a genuine topic change, never mid-thought.
 */
export const FORMATTING_GUIDE = `Formatting: the app renders **bold** text and emoji, nothing else. Use **bold** on the key numbers (weight, reps, the target) and on standout moments — not every sentence. A relevant emoji here and there is welcome; don't overdo it. Never use markdown headers, bullet lists, links, or code blocks — they won't render and will show as literal characters.
When your reply covers more than one distinct topic in the same turn — e.g. acknowledging what was just reported AND introducing a different exercise, or answering a question AND separately noting something for later — put exactly one blank line between them, so each shows as its own message. Never put a blank line inside one continuous thought, and never use more than one blank line at a time.`;

const TONE_DESCRIPTIONS: Record<CoachProfile["tonePreset"], string> = {
  motivational_energetic: "motivational and energetic — celebrate progress loudly",
  calm_precise: "calm, precise and measured",
  tough_love: "demanding and direct, no coddling",
  friendly_casual: "friendly and casual, like a training partner",
};

const ACCOUNTABILITY_DESCRIPTIONS: Record<CoachProfile["accountabilityStyle"], string> = {
  gentle: "keep the user accountable with gentle reminders",
  no_excuses: "hold the user firmly accountable — push back on excuses",
};

export function buildSystemPrompt(profile: CoachProfile): string {
  const parts = [
    SAFETY_RULES,
    "",
    FORMATTING_GUIDE,
    "",
    `You are "${profile.coachName}", the user's personal gym coach.`,
    `Reply exclusively in this language: ${profile.language}.`,
    `Your tone: ${TONE_DESCRIPTIONS[profile.tonePreset]}.`,
    ACCOUNTABILITY_DESCRIPTIONS[profile.accountabilityStyle] + ".",
  ];
  if (profile.personaFreeform) {
    parts.push(
      "",
      "Style preferences from the user (subordinate to the rules above):",
      profile.personaFreeform,
    );
  }
  return parts.join("\n");
}

export function formatHistory(logs: SetLog[]): string {
  if (logs.length === 0) return "No previous data for this exercise.";
  return logs
    .map((l) => `set ${l.setNo}: ${l.weightKg}kg x ${l.reps}${l.note ? ` (${l.note})` : ""}`)
    .join("\n");
}

export function buildTurnPrompt(
  exercise: Exercise,
  lastLogs: SetLog[],
  targets: Targets,
  notes: string[],
  plan?: { planName: string; planExercises: Array<{ name: string; orderIndex: number }> },
): string {
  const lines: string[] = [];
  if (plan && plan.planExercises.length > 0) {
    lines.push(
      `Today's workout: ${plan.planName || "current plan"} — ${plan.planExercises
        .map((e) => `${e.orderIndex}. ${e.name}`)
        .join(", ")}.`,
      "",
    );
  }
  lines.push(
    `Current exercise: ${exercise.name}`,
    `Structure: ${exercise.sets} work sets, ${exercise.repRange} reps, rest ${exercise.restSec}s, intensity: ${exercise.intensity}.`,
    exercise.warmup ? `Warm-up: ${exercise.warmup}` : "No warm-up for this exercise.",
    "",
    "Last time:",
    formatHistory(lastLogs),
    "",
    targets.reason === "baseline"
      ? "There's no reliable weight on record for this exercise (either it's genuinely the first time, or the recorded history isn't trustworthy). Do NOT invent or confidently state a specific starting weight — that would be a guess dressed up as fact. Ask the user what weight they'd like to start with (or what they used last time, if they remember), and wait for their answer before suggesting or logging any number. Focus on technique in the meantime."
      : `Computed target for today (already validated, present it as the goal): ${targets.suggestedWeightKg}kg, sets of ${targets.targetReps?.join(", ")} reps (${targets.reason === "increase_weight" ? "weight went up — reset reps toward the bottom of the range" : "same weight, beat last time's reps"}).`,
  );
  if (notes.length > 0) {
    lines.push("", "Saved notes about this exercise:", ...notes.map((n) => `- ${n}`));
  }
  lines.push(
    "",
    "Write the coaching message for this exercise: last time's numbers, today's target, intensity and rest. End by asking the user to report back after the set.",
  );
  return lines.join("\n");
}

/**
 * Generative-UI confirm action (System Design §19): the numbers are
 * already final (confirmed via button, not typed) — nothing here is
 * extracted or decided by the model, it only narrates. Mirrors
 * buildConversationPrompt's next-exercise section so the reply reads
 * the same whether the user typed or tapped a button.
 */
export function buildConfirmPrompt(params: {
  exercise: Exercise;
  confirmedSets: Array<{ weightKg: number; reps: number }>;
  notes: string[];
  nextExercise: Exercise | null;
  nextTargets: Targets | null;
  nextLastLogs: SetLog[];
  nextNotes: string[];
  /** §20: nextExercise is being resurfaced from the deferred pool, not introduced fresh. */
  isRevisit?: boolean;
}): string {
  const { exercise, confirmedSets, notes, nextExercise, nextTargets, nextLastLogs, nextNotes, isRevisit } = params;
  const setsDesc = confirmedSets.map((s) => `${s.weightKg}kg x ${s.reps}`).join(", ");
  const lines: string[] = [
    `The user just confirmed they completed ${exercise.name}: ${setsDesc}. This came from a quick-confirm UI button, not typed text — there is nothing to interpret or extract, these numbers are already final and logged. Restate them exactly; never alter them.`,
  ];
  if (notes.length > 0) lines.push("", "Saved notes about this exercise:", ...notes.map((n) => `- ${n}`));
  lines.push("", "Write a short, encouraging acknowledgment of what was just done.");
  if (nextExercise && nextTargets) {
    lines.push(
      "",
      isRevisit
        ? `Then, after a blank line (this is a genuinely new topic, not a continuation — see the formatting rules), write a CLEAR note that you're coming back to a deferred exercise: ${nextExercise.name} — say plainly that this is the one that got put off earlier, not a brand-new exercise. There is more workout left — do not use any wrap-up/completion language ("great workout", "that's it for today", "you're done", etc.), that would be misleading; make it unambiguous another exercise follows right now.`
        : `Then, after a blank line (this is a genuinely new topic, not a continuation — see the formatting rules), write a CLEAR introduction to the next exercise: ${nextExercise.name}. There is more workout left — do not use any wrap-up/completion language ("great workout", "that's it for today", "you're done", etc.), that would be misleading; make it unambiguous another exercise follows right now.`,
      `Structure: ${nextExercise.sets} work sets, ${nextExercise.repRange} reps, rest ${nextExercise.restSec}s, intensity: ${nextExercise.intensity}.`,
      nextExercise.warmup ? `Warm-up: ${nextExercise.warmup}` : "No warm-up for this exercise.",
      "Last time on this exercise:",
      formatHistory(nextLastLogs),
      nextTargets.reason === "baseline"
        ? "There's no reliable weight on record for this exercise (either it's genuinely the first time, or the recorded history isn't trustworthy). Do NOT invent or confidently state a specific starting weight — ask the user what weight they'd like to start with, and wait for their answer before suggesting or logging any number. Focus on technique in the meantime."
        : `Computed target for today (already validated, present it as the goal): ${nextTargets.suggestedWeightKg}kg, sets of ${nextTargets.targetReps?.join(", ")} reps.`,
    );
    if (nextNotes.length > 0) lines.push("", "Saved notes about the next exercise:", ...nextNotes.map((n) => `- ${n}`));
  } else {
    lines.push(
      "",
      "This was the LAST exercise in the plan. Warmly wrap up the workout instead of introducing a new exercise — do not fabricate a summary of numbers, that is handled separately.",
    );
  }
  lines.push(
    "",
    "Write the coaching message directly as plain text (not JSON) — in your coaching voice per the rules and tone above, always restating the numbers exactly as given above.",
  );
  return lines.join("\n");
}

/**
 * §20 follow-up compose-only call: used only when a free-text turn's
 * chosen next exercise diverges from the deterministic default it was
 * given full targets for — that first reply deliberately doesn't state
 * numbers for the override (it has none), so this composes the short
 * standalone introduction with the numbers now that they're known.
 */
export function buildOrchestrationIntroPrompt(params: {
  isRevisit: boolean;
  deferReason: string | null;
  nextExercise: Exercise;
  nextTargets: Targets;
  nextLastLogs: SetLog[];
  nextNotes: string[];
}): string {
  const { isRevisit, deferReason, nextExercise, nextTargets, nextLastLogs, nextNotes } = params;
  const lines: string[] = [
    isRevisit
      ? `The user is coming back to ${nextExercise.name}, an exercise deferred earlier this session${deferReason ? ` (reason given at the time: "${deferReason}")` : ""}. Write a short note that plainly says you're returning to it — not introducing it as brand new — then its target.`
      : `The user just asked to switch to a different exercise: ${nextExercise.name}, in place of what was originally planned. Write a short, natural acknowledgment of the switch, then its target.`,
    `Structure: ${nextExercise.sets} work sets, ${nextExercise.repRange} reps, rest ${nextExercise.restSec}s, intensity: ${nextExercise.intensity}.`,
    nextExercise.warmup ? `Warm-up: ${nextExercise.warmup}` : "No warm-up for this exercise.",
    "Last time on this exercise:",
    formatHistory(nextLastLogs),
    nextTargets.reason === "baseline"
      ? "There's no reliable weight on record for this exercise (either it's genuinely the first time, or the recorded history isn't trustworthy). Do NOT invent or confidently state a specific starting weight — ask the user what weight they'd like to start with, and wait for their answer before suggesting or logging any number. Focus on technique in the meantime."
      : `Computed target for today (already validated, present it as the goal): ${nextTargets.suggestedWeightKg}kg, sets of ${nextTargets.targetReps?.join(", ")} reps.`,
  ];
  if (nextNotes.length > 0) lines.push("", "Saved notes about this exercise:", ...nextNotes.map((n) => `- ${n}`));
  lines.push(
    "",
    "Do not use any wrap-up/completion language — there is more workout left right now.",
    "Write the message directly as plain text (not JSON), in your coaching voice per the rules and tone above, keeping it brief since this follows directly after another message in the same turn.",
  );
  return lines.join("\n");
}

/**
 * Free-text mid-workout turn (GYM-61/67, revised for §20's tool-calling
 * rework): describes the situation; the *decisions* — did they finish,
 * did they stop early, are they deferring/switching/substituting, is
 * there a note to save — are made by calling tools (see llm.ts's tool
 * definitions), not by filling in a JSON contract. Tool descriptions
 * carry most of the "when to call what" instructions; this prompt only
 * covers what tool schemas can't: situational context, and the one
 * genuinely ambiguous judgment call (note vs. completion) that survived
 * two rounds of prose-only tightening before (§18.C) — tool-calling
 * fixes *whether the result is internally consistent*, not whether the
 * model's initial read of an ambiguous message is correct, so that
 * specific guardrail still earns its own explicit callout here.
 */
export function buildConversationPrompt(params: {
  exercise: Exercise;
  lastLogs: SetLog[];
  notes: string[];
  userMessage: string;
  recentHistory: Array<{ from: "coach" | "me"; text: string }>;
  currentTargets: Targets | null;
  thisSessionLogs: SetLog[];
  nextExercise: Exercise | null;
  nextTargets: Targets | null;
  nextLastLogs: SetLog[];
  /** The exercise (if any) most recently logged this session before the current one — see correctPreviousExerciseSet. */
  previousExercise: Exercise | null;
  previousExerciseLogs: SetLog[];
}): string {
  const {
    exercise, lastLogs, notes, userMessage, recentHistory,
    currentTargets, thisSessionLogs, nextExercise, nextTargets, nextLastLogs,
    previousExercise, previousExerciseLogs,
  } = params;
  const lines: string[] = [
    `Current exercise: ${exercise.name}`,
    `Structure: ${exercise.sets} work sets, ${exercise.repRange} reps, rest ${exercise.restSec}s, intensity: ${exercise.intensity}.`,
    "Last time:",
    formatHistory(lastLogs),
  ];
  if (currentTargets && currentTargets.suggestedWeightKg != null) {
    lines.push(
      `The weight this exercise was introduced with (before any renegotiation visible below) was ${currentTargets.suggestedWeightKg}kg.`,
    );
  }
  lines.push(
    thisSessionLogs.length > 0
      // Set numbers spelled out explicitly (not just weight x reps) so a
      // correction ("set 2 was actually 8 reps") can reference a real,
      // unambiguous set number — see correctLoggedSet below.
      ? `Already logged THIS session for this exercise (${thisSessionLogs.length} of ${exercise.sets} work sets): ${thisSessionLogs.map((l) => `set ${l.setNo}: ${l.weightKg}kg x ${l.reps}`).join(", ")}.`
      : `Nothing logged yet this session for this exercise (0 of ${exercise.sets} work sets).`,
  );
  if (notes.length > 0) lines.push("", "Saved notes about this exercise:", ...notes.map((n) => `- ${n}`));
  if (previousExercise) {
    lines.push(
      "",
      `The PREVIOUS exercise this session (done right before the current one) was ${previousExercise.name}. Sets logged for it: ${previousExerciseLogs.length > 0 ? previousExerciseLogs.map((l) => `set ${l.setNo}: ${l.weightKg}kg x ${l.reps}`).join(", ") : "none"}.`,
    );
  }
  if (recentHistory.length > 0) {
    lines.push("", "Recent conversation, most recent last (for context, e.g. an agreed target):");
    for (const m of recentHistory) lines.push(`${m.from === "coach" ? "Coach" : "User"}: ${m.text}`);
  }
  lines.push(
    "",
    `The user just said: "${userMessage}"`,
    "",
    "STOP — check this FIRST, before anything else: is this message a pure request/reminder for the future (\"remind me...\", \"note that...\", \"write down...\", \"don't forget...\", \"next time...\") with NOTHING in it describing what the user actually did this set — no numbers, and no plain statement like \"done\"/\"finished\" that stands on its own without needing a reminder framing? If so, this is ONLY a note — call saveNote and do NOT call logCompletedSets. It is NOT a completion, NOT a confirmation, even though it names this exercise, even though a target was already suggested. Do this check even if the message sounds positive or on-topic — mentioning the exercise is not the same as reporting having done it.",
    "",
    "SECOND CHECK: does this message name a SPECIFIC exercise that is NOT the current exercise (\"" + exercise.name + "\")? This matters even if the message otherwise reads exactly like a normal report or correction (numbers, \"actually\"/\"wait\"/\"I meant\", etc.) — a real production bug came from logging a message like this against the current exercise just because it had numbers in it, when the user was actually talking about a different one." +
      (previousExercise
        ? ` If the named exercise matches the PREVIOUS exercise (${previousExercise.name}, listed above), it's a correction to THAT exercise, not the current one — call correctPreviousExerciseSet with the set number and corrected weight/reps, never logCompletedSets or correctLoggedSet (those only ever apply to the current exercise, ${exercise.name}). If the named exercise matches neither the current nor the previous one, or it's ambiguous which set they mean, call no tool — tell the user plainly you can only fix the current exercise or the one right before it, and ask them to clarify.`
        : ` There is no previous exercise logged this session to attribute it to, so if the name doesn't match the current exercise, call no tool — tell the user plainly you can only log/correct the current exercise (${exercise.name}) right now, and ask them to clarify what they meant.`) +
      " If the message does NOT name a different exercise (it's about the current one, or names no exercise at all), move on to the next check.",
    "",
    "THIRD CHECK: is this message CORRECTING a set already listed under \"Already logged THIS session\" above, not reporting a new one? Signaled by words like \"actually\", \"wait\", \"I meant\", \"that's wrong\", \"correction\", or by stating a number that plainly contradicts what's already logged for a specific past set. If so, call correctLoggedSet with that set's number and the corrected weight and/or reps — never logCompletedSets, which would wrongly add it as an extra new set on top of the wrong one. If it's unclear which already-logged set they mean (e.g. more than one is logged and they didn't say which), ask instead of guessing; call no tool yet.",
    "",
    "Otherwise, extract whatever sets THIS message reports (weight in kg, reps) and call logCompletedSets with them — its result tells you how many of this exercise's sets are now accounted for in total (combining what's already logged this session with what you just added), so you don't need to track that yourself. If one weight was stated for the whole exercise, use it for every set reported. If the user reports reps but this message states no weight at all, use the weight already established for this exercise instead — either one negotiated in the conversation above, or the introduction weight given above. weightKg=0 is only correct for a genuinely bodyweight exercise with no weight ever mentioned; never use 0 just because this message omitted repeating an already-established weight. If no weight can be determined at all — not in this message, not negotiated above, no introduction weight given — do not call logCompletedSets with a guess: ask the user what weight they used instead, and wait for their answer.",
    "The same applies to reps, the other direction: if a weight is stated but no rep count is given and none can be inferred from context, do NOT assume the target reps were hit — reps are the one number that genuinely varies set to set, so a missing rep count is never safe to guess, even when a target was suggested. Ask the user how many reps per set, and wait for their answer, exactly as you would for a missing weight.",
    "A bare standalone confirmation with no numbers at all (\"yes\", \"done\", \"finished\", nothing else — not a reminder/request) only counts as a completed-set report if YOUR OWN last message (shown as \"Coach:\" in the recent conversation above) was itself asking the user to report back AFTER doing the set (e.g. \"report back after your set\", \"let me know how it goes\", \"done?\") — only then, and only if the conversation already establishes a specific weight/rep target for every set, call logCompletedSets with that agreed target. If instead your own last message was asking whether the user is ready or wants to begin (e.g. \"ready to start?\", \"sound good?\", \"let's go?\") — a bare \"yes\" there means \"I'm about to start\", not \"I already finished\": call no tool, just acknowledge briefly and wait for the real report once the set is actually done.",
    `If the full ${exercise.sets} sets aren't accounted for yet and the user hasn't indicated they're stopping early, just call logCompletedSets with what this message reports (if anything) and acknowledge what came in — ask for the rest, don't call stopExerciseEarly or anything else.`,
    "If the user explicitly moves on early — either directly (\"let's skip the rest\", \"that's enough for this one\") or by giving a reason that makes clear they want to stop now, not just complaining (\"the machine's taken\", \"someone's using it\", \"this is hurting my shoulder\", \"I'm short on time\") — call stopExerciseEarly (after logCompletedSets, if this message also reported anything).",
    "Otherwise (a question, a request to change the target, reporting pain, general chat, nothing about performance) — call no tool at all. Respond directly to what the user said in your final message: if they're proposing a different weight/reps, acknowledge and confirm the new target for this same exercise; if they report pain, follow the safety rules; do not introduce a new exercise.",
    "",
    "Separately from all of the above (a message can be both a report AND contain a note): if any part of what the user said is worth remembering for a future session — a technique cue, a request for next time, something about how the exercise felt — call saveNote too, in the same turn as any other tool call. If the same note (in substance) already appears in \"Saved notes about this exercise\" above, it's already recorded — acknowledge it conversationally if relevant, don't call saveNote again for it. If instead the user is correcting the wording of a note you just saved (\"actually make that my left knee, not my right\"), call correctNote with the corrected text, not saveNote.",
  );
  lines.push(
    "",
    `Session flow: by default, once this exercise is done (full sets logged, or you called stopExerciseEarly), the next one is already decided — ${nextExercise ? nextExercise.name : "nothing, this is the last one"} — and its numbers are given below; just narrate it, no tool call needed for that. Only look up switchToExercise/substituteExercise/deferCurrentExercise if the user's message right now explicitly asks to skip/defer/reorder/swap what's coming — this includes a stated REASON to move on (equipment busy, something hurts) just as much as a stated reason something is now AVAILABLE again (a machine/equipment freed up, someone finished using it) — both are the user telling you to act, not making small talk. A plain set report, a question, or small talk must never touch these — this is a hard rule, not a preference. If they clearly want to change what's next but haven't said what to switch to, ask what they'd like instead — call no flow-changing tool yet.`,
    "CRITICAL: never describe a switch, defer, or substitution in your final reply unless the matching tool call actually succeeded this turn (its result confirmed it, not an error). If a tool call fails or you never call one, your reply must reflect that nothing changed — do not narrate an action you didn't successfully take, even if the user's intent seemed clear. A reply that promises a switch which didn't really happen leaves the app pointing at the wrong exercise.",
  );
  if (nextExercise && nextTargets) {
    lines.push(
      "",
      `Once this exercise is done, IF you haven't called switchToExercise/substituteExercise (the default stands): first acknowledge what was just logged, then — after a blank line, since the next exercise is a genuinely new topic, not a continuation — write a CLEAR introduction to it: ${nextExercise.name}. There is more workout left — do not use any wrap-up/completion language ("great workout", "that's it for today", "you're done", etc.) here, that would be misleading; the message must make it unambiguous that another exercise follows right now.`,
      `Structure: ${nextExercise.sets} work sets, ${nextExercise.repRange} reps, rest ${nextExercise.restSec}s, intensity: ${nextExercise.intensity}.`,
      nextExercise.warmup ? `Warm-up: ${nextExercise.warmup}` : "No warm-up for this exercise.",
      "Last time on this exercise:",
      formatHistory(nextLastLogs),
      nextTargets.reason === "baseline"
        ? "There's no reliable weight on record for this exercise (either it's genuinely the first time, or the recorded history isn't trustworthy). Do NOT invent or confidently state a specific starting weight — that would be a guess dressed up as fact. Ask the user what weight they'd like to start with (or what they used last time, if they remember), and wait for their answer before suggesting or logging any number. Focus on technique in the meantime."
        : `Computed target for today (already validated, present it as the goal): ${nextTargets.suggestedWeightKg}kg, sets of ${nextTargets.targetReps?.join(", ")} reps.`,
    );
  } else if (!nextExercise) {
    lines.push(
      "",
      "This is the LAST exercise in the plan. Once it's done, warmly wrap up the workout instead of introducing a new exercise — do not fabricate a summary of numbers, that is handled separately.",
    );
  }
  lines.push(
    "",
    "Once you're done calling any tools you need (or if none apply), write your final reply directly as plain text — in your coaching voice per the rules and tone above, always restating any numbers you recorded.",
  );
  return lines.join("\n");
}
