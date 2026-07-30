import type { EquipmentType, Exercise, SetLog } from "@gymcoach/shared";

/**
 * Progressive-overload rules (GYM-19, deterministic node).
 *
 * Encodes the coach's training rules rather than trusting the LLM with
 * arithmetic:
 *  - Work within the exercise's rep range.
 *  - Readiness for more weight is judged from the freshest work set (the
 *    first one performed at the top weight), not every set: later sets
 *    naturally fatigue, and once the freshest set already clears the
 *    range's ceiling, asking for MORE reps is impossible and asking for
 *    FEWER reads as a regression — the plan's ceiling was reached, not
 *    "not enough". So: first set at/above ceiling -> increase weight
 *    (equipment-appropriate jump, see incrementForEquipment) and reset
 *    toward the bottom of the range.
 *  - Otherwise keep the weight and target +1 rep on sets below the
 *    ceiling — a set that already independently reached the ceiling
 *    holds there rather than being walked backward.
 *  - No history -> baseline session: find working weights, no targets.
 */

export interface Targets {
  suggestedWeightKg: number | null;
  targetReps: number[] | null;
  reason: "baseline" | "increase_weight" | "add_reps" | "hold";
}

/** Fallback for an unrecognized/unset equipment type — matches a barbell's
 * real-world smallest common jump (a 1.25kg plate per side). */
export const DEFAULT_WEIGHT_INCREMENT_KG = 2.5;

/**
 * Real-world smallest jump each equipment type can actually give the user.
 * Dumbbell racks step per-dumbbell (2-2.5kg), so the two-hand total jumps
 * 4-5kg at a time — noticeably more than a barbell's per-side plate jump.
 * Machines/cables are typically pin-loaded in coarser 5kg steps.
 */
const INCREMENT_BY_EQUIPMENT: Record<EquipmentType, number> = {
  barbell: 2.5,
  dumbbell: 5,
  machine: 5,
  cable: 5,
  bodyweight: DEFAULT_WEIGHT_INCREMENT_KG,
  other: DEFAULT_WEIGHT_INCREMENT_KG,
};

export function incrementForEquipment(equipmentType: EquipmentType | null): number {
  return equipmentType ? INCREMENT_BY_EQUIPMENT[equipmentType] : DEFAULT_WEIGHT_INCREMENT_KG;
}

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

  const readyForMoreWeight =
    topWeightSets.length >= exercise.sets && (topWeightSets[0]?.reps ?? 0) >= max;

  if (readyForMoreWeight) {
    return {
      suggestedWeightKg: topWeight + incrementForEquipment(exercise.equipmentType),
      targetReps: Array(exercise.sets).fill(min),
      reason: "increase_weight",
    };
  }

  // Same weight, nudge each set toward one more rep — clamped into the
  // range, so a set that fell below the floor targets the floor. A set
  // that already independently reached the ceiling holds there instead
  // of being walked backward below what was actually already performed.
  const targetReps = Array.from({ length: exercise.sets }, (_, i) => {
    const prev = topWeightSets[i]?.reps ?? min;
    if (prev >= max) return prev;
    return Math.min(Math.max(prev + 1, min), max);
  });

  const anyBelow = topWeightSets.some((l) => l.reps < max);
  return {
    suggestedWeightKg: topWeight,
    targetReps,
    reason: anyBelow ? "add_reps" : "hold",
  };
}
