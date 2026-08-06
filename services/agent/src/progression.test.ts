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
  assert.equal(t.targetWeights, null);
});

test("a logged weight of 0 is never trusted as a real working weight -> treated as baseline, not suggested as a target", () => {
  const t = suggestTargets(exercise, logs([[0, 8], [0, 8], [0, 8]]));
  assert.equal(t.reason, "baseline");
  assert.equal(t.suggestedWeightKg, null);
  assert.deepEqual(t.targetReps, [6, 6, 6]);
  assert.equal(t.targetWeights, null);
});

test("all sets at range ceiling -> weight jumps by the equipment's real increment, reps reset to bottom", () => {
  const t = suggestTargets(exercise, logs([[50, 10], [50, 10], [50, 11]]));
  assert.equal(t.reason, "increase_weight");
  assert.equal(t.suggestedWeightKg, 50 + incrementForEquipment("machine"));
  assert.deepEqual(t.targetReps, [6, 6, 6]);
  assert.deepEqual(t.targetWeights, [55, 55, 55]);
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
  assert.deepEqual(t.targetWeights, [50, 50, 50]);
});

test("real regression: 12/11/7 against a 6-10 range increases weight, not a lower rep target (GYM feedback)", () => {
  // The freshest (first) set already exceeded the range ceiling — later
  // sets fatiguing is normal and shouldn't produce a target BELOW what
  // was already achieved on set 1.
  const t = suggestTargets(exercise, logs([[50, 12], [50, 11], [50, 7]]));
  assert.equal(t.reason, "increase_weight");
  assert.equal(t.suggestedWeightKg, 50 + incrementForEquipment("machine"));
  assert.deepEqual(t.targetReps, [6, 6, 6]);
  assert.deepEqual(t.targetWeights, [55, 55, 55]);
});

test("a non-first set that independently exceeded ceiling holds there, not reduced, even when weight doesn't increase", () => {
  // First set (6) is below ceiling, so overall we're not ready for more
  // weight yet — but set 3 (11) already passed the ceiling on its own
  // and must never be walked backward to fit the range.
  const t = suggestTargets(exercise, logs([[50, 6], [50, 6], [50, 11]]));
  assert.equal(t.reason, "add_reps");
  assert.equal(t.suggestedWeightKg, 50);
  assert.deepEqual(t.targetReps, [7, 7, 11]);
  assert.deepEqual(t.targetWeights, [50, 50, 50]);
});

test("set below range floor targets the floor, not floor-minus-something", () => {
  const t = suggestTargets(exercise, logs([[50, 9], [50, 6], [50, 4]]));
  assert.deepEqual(t.targetReps, [10, 7, 6]);
  assert.deepEqual(t.targetWeights, [50, 50, 50]);
});

test("inverted pyramid (mixed weights): progression judged at top weight, each set keeps its own weight", () => {
  // 3 work sets but only 2 at the top weight -> not "all at ceiling"
  const t = suggestTargets(exercise, logs([[50, 10], [50, 10], [45, 10]]));
  assert.equal(t.suggestedWeightKg, 50);
  assert.notEqual(t.reason, "increase_weight");
  // The 3rd set (dropped to 45kg) still really happened at 10 reps, at
  // 45kg — the target for that slot must reflect BOTH: never a rep value
  // invented from the plan's floor, and never pulled up to the top
  // weight it wasn't actually performed at.
  assert.deepEqual(t.targetReps, [10, 10, 10]);
  assert.deepEqual(t.targetWeights, [50, 50, 45]);
});

test("real regression: a later set at a DIFFERENT (lower) weight keeps its own weight and reps, never pulled to the top weight or the plan's floor", () => {
  // Exact user-reported scenario: 18kg x8, 18kg x8, then dropped to 16kg
  // for a 3rd set at 7 reps. The bug was two-fold: defaulting the 3rd
  // set's REPS to the plan's floor (8) as if nothing was logged, AND
  // (once that was fixed) still suggesting the top weight (18kg) for
  // that set instead of continuing its own lower-weight track.
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const t = suggestTargets(wideRange, logs([[18, 8], [18, 8], [16, 7]]));
  assert.equal(t.reason, "add_reps");
  assert.equal(t.suggestedWeightKg, 18);
  // Sets 1-2 (at the top weight, 8 reps, below the 12 ceiling) nudge to 9.
  // Set 3 keeps ITS OWN weight (16kg) and nudges its own real reps (7) to 8.
  assert.deepEqual(t.targetReps, [9, 9, 8]);
  assert.deepEqual(t.targetWeights, [18, 18, 16]);
});

test("real regression: a low-rep set at a different weight nudges by +1 without being floor-clamped to the plan's minimum", () => {
  // User-reported follow-up: 18kg x7, 18kg x7, then 16kg x1 (a much
  // harder-earned single, e.g. after two hard sets). Expected next
  // target: 18kg x8, 18kg x8, 16kg x2 — the 3rd set's own weight and a
  // plain +1 nudge, NOT walked up to the plan's floor of 8 (that floor
  // only applies to sets at the plan's own working weight) and NOT
  // pulled up to 18kg.
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const t = suggestTargets(wideRange, logs([[18, 7], [18, 7], [16, 1]]));
  assert.equal(t.reason, "add_reps");
  assert.equal(t.suggestedWeightKg, 18);
  assert.deepEqual(t.targetReps, [8, 8, 2]);
  assert.deepEqual(t.targetWeights, [18, 18, 16]);
});
