import type { Exercise, SetLog } from "@gymcoach/shared";

/**
 * Progressive-overload rules (GYM-19, deterministic node).
 *
 * Encodes the coach's training rules rather than trusting the LLM with
 * arithmetic:
 *  - Work within the exercise's rep range.
 *  - If every work set reached the top of the range at the same weight,
 *    increase weight (+2.5kg) and reset toward the bottom of the range.
 *  - Otherwise keep the weight and target +1 rep on the weakest sets.
 *  - No history -> baseline session: find working weights, no targets.
 */

export interface Targets {
  suggestedWeightKg: number | null;
  targetReps: number[] | null;
  reason: "baseline" | "increase_weight" | "add_reps" | "hold";
}

export const WEIGHT_INCREMENT_KG = 2.5;

export function parseRepRange(repRange: string): { min: number; max: number } {
  const m = repRange.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) {
    const single = Number(repRange);
    if (Number.isInteger(single) && single > 0) return { min: single, max: single };
    return { min: 8, max: 12 };
  }
  return { min: Number(m[1]), max: Number(m[2]) };
}

export function suggestTargets(exercise: Exercise, lastLogs: SetLog[]): Targets {
  if (lastLogs.length === 0) {
    return { suggestedWeightKg: null, targetReps: null, reason: "baseline" };
  }

  const { min, max } = parseRepRange(exercise.repRange);
  const ordered = [...lastLogs].sort((a, b) => a.setNo - b.setNo);
  const topWeight = Math.max(...ordered.map((l) => l.weightKg));
  const topWeightSets = ordered.filter((l) => l.weightKg === topWeight);

  const allAtCeiling =
    topWeightSets.length >= exercise.sets &&
    topWeightSets.every((l) => l.reps >= max);

  if (allAtCeiling) {
    return {
      suggestedWeightKg: topWeight + WEIGHT_INCREMENT_KG,
      targetReps: Array(exercise.sets).fill(min),
      reason: "increase_weight",
    };
  }

  // Same weight, nudge each set toward one more rep — clamped into the
  // range, so a set that fell below the floor targets the floor, not
  // another out-of-range number.
  const targetReps = Array.from({ length: exercise.sets }, (_, i) => {
    const prev = topWeightSets[i]?.reps ?? min;
    return Math.min(Math.max(prev + 1, min), max);
  });

  const anyBelow = topWeightSets.some((l) => l.reps < max);
  return {
    suggestedWeightKg: topWeight,
    targetReps,
    reason: anyBelow ? "add_reps" : "hold",
  };
}
