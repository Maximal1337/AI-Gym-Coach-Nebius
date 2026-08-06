import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestTargets, parseRepRange, incrementForEquipment, DEFAULT_WEIGHT_INCREMENT_KG } from "./progression.js";
import type { Exercise, SetLog } from "@gymcoach/shared";

const exercise: Exercise = {
  id: "e1",
  planId: "p1",
  orderIndex: 1,
  name: "Machine Chest Press",
  sets: 3,
  repRange: "6-10",
  restSec: 120,
  intensity: "RIR 1-2",
  warmup: null,
  equipmentType: "machine",
};

function logs(weightReps: Array<[number, number]>): SetLog[] {
  return weightReps.map(([weightKg, reps], i) => ({
    id: `l${i}`,
    sessionId: "s1",
    exerciseId: "e1",
    setNo: i + 1,
    weightKg,
    reps,
    note: null,
    createdAt: "2026-07-23T17:00:00Z",
  }));
}

test("parseRepRange handles ranges, single values, junk", () => {
  assert.deepEqual(parseRepRange("6-10"), { min: 6, max: 10 });
  assert.deepEqual(parseRepRange("12"), { min: 12, max: 12 });
  assert.deepEqual(parseRepRange("whatever"), { min: 8, max: 12 });
});

test("no history -> baseline, reps default to the plan's rep-range floor (weight stays unknown)", () => {
  const t = suggestTargets(exercise, []);
  assert.equal(t.reason, "baseline");
  assert.equal(t.suggestedWeightKg, null);
  assert.deepEqual(t.targetReps, [6, 6, 6]);
});

test("a logged weight of 0 is never trusted as a real working weight -> treated as baseline, not suggested as a target", () => {
  const t = suggestTargets(exercise, logs([[0, 8], [0, 8], [0, 8]]));
  assert.equal(t.reason, "baseline");
  assert.equal(t.suggestedWeightKg, null);
  assert.deepEqual(t.targetReps, [6, 6, 6]);
});

test("all sets at range ceiling -> weight jumps by the equipment's real increment, reps reset to bottom", () => {
  const t = suggestTargets(exercise, logs([[50, 10], [50, 10], [50, 11]]));
  assert.equal(t.reason, "increase_weight");
  assert.equal(t.suggestedWeightKg, 50 + incrementForEquipment("machine"));
  assert.deepEqual(t.targetReps, [6, 6, 6]);
});

test("incrementForEquipment: dumbbell/machine/cable jump more than a barbell; unset falls back to the default", () => {
  assert.equal(incrementForEquipment("barbell"), 2.5);
  assert.equal(incrementForEquipment("dumbbell"), 5);
  assert.equal(incrementForEquipment("machine"), 5);
  assert.equal(incrementForEquipment("cable"), 5);
  assert.equal(incrementForEquipment(null), DEFAULT_WEIGHT_INCREMENT_KG);
});

test("weight-increase suggestion uses the exercise's own equipment type, not a flat constant", () => {
  const barbellSquat: Exercise = { ...exercise, equipmentType: "barbell" };
  const dumbbellCurl: Exercise = { ...exercise, equipmentType: "dumbbell" };
  const atCeiling = logs([[50, 10], [50, 10], [50, 11]]);
  assert.equal(suggestTargets(barbellSquat, atCeiling).suggestedWeightKg, 52.5);
  assert.equal(suggestTargets(dumbbellCurl, atCeiling).suggestedWeightKg, 55);
});

test("no sets below ceiling but not all reached it -> same weight, +1 rep, capped", () => {
  const t = suggestTargets(exercise, logs([[50, 9], [50, 8], [50, 7]]));
  assert.equal(t.reason, "add_reps");
  assert.equal(t.suggestedWeightKg, 50);
  assert.deepEqual(t.targetReps, [10, 9, 8]);
});

test("real regression: 12/11/7 against a 6-10 range increases weight, not a lower rep target (GYM feedback)", () => {
  // The freshest (first) set already exceeded the range ceiling — later
  // sets fatiguing is normal and shouldn't produce a target BELOW what
  // was already achieved on set 1.
  const t = suggestTargets(exercise, logs([[50, 12], [50, 11], [50, 7]]));
  assert.equal(t.reason, "increase_weight");
  assert.equal(t.suggestedWeightKg, 50 + incrementForEquipment("machine"));
  assert.deepEqual(t.targetReps, [6, 6, 6]);
});

test("a non-first set that independently exceeded ceiling holds there, not reduced, even when weight doesn't increase", () => {
  // First set (6) is below ceiling, so overall we're not ready for more
  // weight yet — but set 3 (11) already passed the ceiling on its own
  // and must never be walked backward to fit the range.
  const t = suggestTargets(exercise, logs([[50, 6], [50, 6], [50, 11]]));
  assert.equal(t.reason, "add_reps");
  assert.equal(t.suggestedWeightKg, 50);
  assert.deepEqual(t.targetReps, [7, 7, 11]);
});

test("set below range floor targets the floor, not floor-minus-something", () => {
  const t = suggestTargets(exercise, logs([[50, 9], [50, 6], [50, 4]]));
  assert.deepEqual(t.targetReps, [10, 7, 6]);
});

test("inverted pyramid (mixed weights): progression judged at top weight", () => {
  // 3 work sets but only 2 at the top weight -> not "all at ceiling"
  const t = suggestTargets(exercise, logs([[50, 10], [50, 10], [45, 10]]));
  assert.equal(t.suggestedWeightKg, 50);
  assert.notEqual(t.reason, "increase_weight");
  // The 3rd set (dropped to 45kg) still really happened at 10 reps — the
  // target for that slot must reflect that, never a value invented from
  // the plan's floor just because the set fell outside topWeightSets.
  assert.deepEqual(t.targetReps, [10, 10, 10]);
});

test("real regression: a later set at a DIFFERENT (lower) weight must never be replaced by the plan's floor in next-session targets", () => {
  // Exact user-reported scenario: 18kg x8, 18kg x8, then dropped to 16kg
  // for a 3rd set at 7 reps. The 3rd set has no entry in topWeightSets
  // (its weight isn't the session's top weight of 18kg) — the bug was
  // defaulting that slot to the plan's floor (8) as if nothing was
  // logged, silently discarding the real, lower 7-rep performance.
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const t = suggestTargets(wideRange, logs([[18, 8], [18, 8], [16, 7]]));
  assert.equal(t.reason, "add_reps");
  assert.equal(t.suggestedWeightKg, 18);
  // Sets 1-2 (at the top weight, 8 reps, below the 12 ceiling) nudge to 9.
  // Set 3 has no top-weight entry, so it must fall back to what was
  // ACTUALLY performed there (7 reps at 16kg), nudged to 8 — never the
  // plan's floor value standing in for a real number.
  assert.deepEqual(t.targetReps, [9, 9, 8]);
});
