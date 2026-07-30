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
- Keep each reply to one complete message.`;

/** The client renders **bold** and emoji; nothing else (no headers, lists, links, code blocks). */
export const FORMATTING_GUIDE = `Formatting: the app renders **bold** text and emoji, nothing else. Use **bold** on the key numbers (weight, reps, the target) and on standout moments — not every sentence. A relevant emoji here and there is welcome; don't overdo it. Never use markdown headers, bullet lists, links, or code blocks — they won't render and will show as literal characters.`;

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
}): string {
  const { exercise, confirmedSets, notes, nextExercise, nextTargets, nextLastLogs, nextNotes } = params;
  const setsDesc = confirmedSets.map((s) => `${s.weightKg}kg x ${s.reps}`).join(", ");
  const lines: string[] = [
    `The user just confirmed they completed ${exercise.name}: ${setsDesc}. This came from a quick-confirm UI button, not typed text — there is nothing to interpret or extract, these numbers are already final and logged. Restate them exactly; never alter them.`,
  ];
  if (notes.length > 0) lines.push("", "Saved notes about this exercise:", ...notes.map((n) => `- ${n}`));
  lines.push("", "Write a short, encouraging acknowledgment of what was just done.");
  if (nextExercise && nextTargets) {
    lines.push(
      "",
      `Then weave in a CLEAR introduction to the next exercise: ${nextExercise.name}. There is more workout left — do not use any wrap-up/completion language ("great workout", "that's it for today", "you're done", etc.), that would be misleading; make it unambiguous another exercise follows right now.`,
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
 * Free-text mid-workout turn (GYM-61/67): interpret what the user just
 * said about the current exercise, decide whether it's a completed
 * report (advance) or something else (renegotiation, a question, an
 * issue), and — if advancing and another exercise follows — weave in its
 * introduction using an already-computed (deterministic) target.
 */
export function buildConversationPrompt(params: {
  exercise: Exercise;
  lastLogs: SetLog[];
  notes: string[];
  userMessage: string;
  recentHistory: Array<{ from: "coach" | "me"; text: string }>;
  currentTargets: Targets | null;
  nextExercise: Exercise | null;
  nextTargets: Targets | null;
  nextLastLogs: SetLog[];
}): string {
  const {
    exercise, lastLogs, notes, userMessage, recentHistory,
    currentTargets, nextExercise, nextTargets, nextLastLogs,
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
  if (notes.length > 0) lines.push("", "Saved notes about this exercise:", ...notes.map((n) => `- ${n}`));
  if (recentHistory.length > 0) {
    lines.push("", "Recent conversation, most recent last (for context, e.g. an agreed target):");
    for (const m of recentHistory) lines.push(`${m.from === "coach" ? "Coach" : "User"}: ${m.text}`);
  }
  lines.push(
    "",
    `The user just said: "${userMessage}"`,
    "",
    "STOP — check this FIRST, before anything else below: is this message a pure request/reminder for the future (\"remind me...\", \"note that...\", \"write down...\", \"don't forget...\", \"next time...\") with NOTHING in it describing what the user actually did this set — no numbers, and no plain statement like \"done\"/\"finished\" that stands on its own without needing a reminder framing? If so, this is ONLY a note. It is NOT a completion, NOT a confirmation, and must NEVER be logged as if the suggested target was performed — even though it names this exercise, even though a target was already suggested. Set advance=false, loggedSets=[], and skip straight to the noteToSave instructions below. Do this check even if the message sounds positive or on-topic — mentioning the exercise is not the same as reporting having done it.",
    "",
    `Otherwise, work out how many of this exercise's ${exercise.sets} work sets are now accounted for, combining this message with anything already reported earlier in the recent conversation above (the user may report sets across more than one message) — then decide:`,
    `- If ALL ${exercise.sets} work sets are now accounted for: extract every set's weight (kg) and reps, in order, into loggedSets (include sets reported in earlier messages too, not just this one). If one weight was stated for the whole exercise, use it for every set. If the user reports reps but this message states no weight at all, use the weight already established for this exercise instead — either one the user negotiated in the conversation above, or otherwise the introduction weight given above. weightKg=0 is only correct for a genuinely bodyweight exercise with no weight ever mentioned; never use 0 just because this particular message omitted repeating an already-established weight. If no weight can be determined at all — not in this message, not negotiated above, and no introduction weight was given above — do NOT log 0kg: set advance=false, loggedSets=[], and ask the user what weight they used before logging anything. Otherwise set advance=true.`,
    "- If the message contains no numbers at all but is a plain, standalone statement that the exercise is done (e.g. only \"done\", \"I did it\", \"finished\", nothing else) AND the recent conversation already establishes a specific weight/rep target for every set (either the suggested target, or one the user negotiated), log that agreed target as loggedSets and set advance=true. (This is different from the note check above — a bare confirmation with no reminder/request framing at all.)",
    `- If only SOME of the ${exercise.sets} sets are accounted for and the user has not indicated they are stopping early: set advance=false and loggedSets=[]. Acknowledge what came in so far and ask for the remaining sets — do not advance on a partial report.`,
    "- If the user explicitly moves on early (e.g. \"let's skip the rest\", \"that's enough for this one\") with fewer than the full set count: log whatever sets were reported (may be fewer than the full count, or none) and set advance=true.",
    "- Otherwise (a question, a request to change the target, reporting pain, general chat, nothing about performance): set advance=false and loggedSets=[]. Respond directly to what the user said — if they're proposing a different weight/reps, acknowledge and confirm the new target for this same exercise; if they report pain, follow the safety rules; do not introduce a new exercise.",
    "",
    "Separately from all of the above (a message can be both a report AND contain a note): if any part of what the user said is worth remembering for a future session — a technique cue (\"remind me to keep my elbows tucked\"), a request for next time (\"do a 10 minute warm-up walk before we start\"), something about how the exercise felt worth flagging next time — set noteToSave to {\"text\": <the note, written as a short second-person reminder, in the user's language>, \"general\": <true if it's about the workout/session as a whole or a future session, not this specific exercise; false if it's specific to this exercise>}. Acknowledge in your message that you'll remember it, the way a real trainer would. If the same note (in substance) already appears in \"Saved notes about this exercise\" above, it's already recorded — acknowledge it conversationally if relevant, but set noteToSave to null rather than saving a duplicate. If there's nothing new worth remembering, set noteToSave to null.",
  );
  if (nextExercise && nextTargets) {
    lines.push(
      "",
      `If advance=true, weave in a CLEAR introduction to the next exercise after acknowledging what was just logged: ${nextExercise.name}. There is more workout left — do not use any wrap-up/completion language ("great workout", "that's it for today", "you're done", etc.) here, that would be misleading; the message must make it unambiguous that another exercise follows right now.`,
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
      "This is the LAST exercise in the plan. If advance=true, warmly wrap up the workout instead of introducing a new exercise — do not fabricate a summary of numbers, that is handled separately.",
    );
  }
  lines.push(
    "",
    'Reply with ONLY valid JSON matching: {"message": string, "loggedSets": [{"weightKg": number, "reps": number}], "advance": boolean, "noteToSave": {"text": string, "general": boolean} | null}. "message" is what the user reads — write it in your coaching voice per the rules and tone above, and always restate any numbers you record.',
  );
  return lines.join("\n");
}
