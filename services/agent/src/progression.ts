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
 *  - A set logged at a DIFFERENT weight than the exercise's top weight
 *    (e.g. a fatigue drop, or a deliberate pyramid) is its own track, not
 *    noise: it keeps ITS OWN weight next time and nudges +1 rep from
 *    what was actually done there — never pulled up to match the top
 *    weight, and never floor-clamped to the plan's rep-range minimum
 *    (that floor represents the plan's intended WORKING weight; it
 *    doesn't apply to a weight the user chose to be lighter). The user's
 *    real reported numbers are the source of truth for what happened —
 *    the plan's range only ever shapes the SUGGESTION on top of that,
 *    never replaces the record of what was actually done.
 *  - No history -> baseline session: find working weights, no targets.
 */

export interface Targets {
  /** The primary/top weight — kept for simple display and the baseline/increase-weight cases, where every set genuinely shares one weight. */
  suggestedWeightKg: number | null;
  targetReps: number[] | null;
  /** Per-set weight, one entry per work set — the real source of truth for what to suggest at each set index, since not every set necessarily shares suggestedWeightKg (see the "different weight" case above). Null only at baseline, where no weight is known yet at all. */
  targetWeights: number[] | null;
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
  const { min, max } = parseRepRange(exercise.repRange);

  // Baseline (no trustworthy weight on record): the weight is still
  // unknown — never invent one — but the plan already specifies a rep
  // target (the range's floor), so that much doesn't need to come from
  // the user. Set rows can start from the plan's own numbers instead of
  // a blank placeholder.
  if (lastLogs.length === 0) {
    return {
      suggestedWeightKg: null, targetReps: Array(exercise.sets).fill(min),
      targetWeights: null, reason: "baseline",
    };
  }

  const ordered = [...lastLogs].sort((a, b) => a.setNo - b.setNo);
  const topWeight = Math.max(...ordered.map((l) => l.weightKg));

  // A logged weight of 0 isn't a real working weight (e.g. a report that
  // got mis-extracted, or an exercise that was never actually assigned a
  // load) — never build a suggestion on top of it. Treat it exactly like
  // no history: ask the user for a starting weight instead of presenting
  // "0kg" (or a trivial +2.5kg off of it) as if it were a real target.
  if (topWeight <= 0) {
    return {
      suggestedWeightKg: null, targetReps: Array(exercise.sets).fill(min),
      targetWeights: null, reason: "baseline",
    };
  }

  const topWeightSets = ordered.filter((l) => l.weightKg === topWeight);

  const readyForMoreWeight =
    topWeightSets.length >= exercise.sets && (topWeightSets[0]?.reps ?? 0) >= max;

  if (readyForMoreWeight) {
    // Ready to move the WHOLE exercise up together — every set (including
    // any that had been trailing at a lower weight) resets to the new
    // weight and the range's floor; there's no "own track" left to
    // preserve once the plan's own working weight has cleared the ceiling.
    const nextWeight = topWeight + incrementForEquipment(exercise.equipmentType);
    return {
      suggestedWeightKg: nextWeight,
      targetReps: Array(exercise.sets).fill(min),
      targetWeights: Array(exercise.sets).fill(nextWeight),
      reason: "increase_weight",
    };
  }

  // Not ready to move up: nudge each set toward one more rep from what it
  // ACTUALLY did last time, at the weight it actually did it at — never a
  // plan assumption standing in for either number. A set performed at the
  // exercise's top weight follows the plan's own rep range (clamped into
  // it, so a set that fell below the floor targets the floor — that floor
  // is the plan's intended working weight, a reasonable goal). A set
  // performed at a DIFFERENT (typically lower, fatigue-driven) weight is
  // its own track: it keeps that weight and just gets a +1 nudge, capped
  // at the range's ceiling but never floor-clamped — the floor doesn't
  // apply to a weight the user chose to be lighter than the plan's own.
  const targetReps: number[] = [];
  const targetWeights: number[] = [];
  for (let i = 0; i < exercise.sets; i++) {
    const last = ordered[i];
    if (!last) {
      // No logged set at all for this index last time -- the plan's own
      // numbers are the only anchor available.
      targetWeights.push(topWeight);
      targetReps.push(min);
      continue;
    }
    if (last.weightKg === topWeight) {
      targetWeights.push(topWeight);
      targetReps.push(last.reps >= max ? last.reps : Math.min(Math.max(last.reps + 1, min), max));
    } else {
      targetWeights.push(last.weightKg);
      targetReps.push(last.reps >= max ? last.reps : Math.min(last.reps + 1, max));
    }
  }

  const anyBelow = topWeightSets.some((l) => l.reps < max);
  return {
    suggestedWeightKg: topWeight,
    targetReps,
    targetWeights,
    reason: anyBelow ? "add_reps" : "hold",
  };
}
