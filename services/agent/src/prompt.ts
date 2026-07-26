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
      ? "This is the first session for this exercise: help the user find working weights, focus on technique."
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
