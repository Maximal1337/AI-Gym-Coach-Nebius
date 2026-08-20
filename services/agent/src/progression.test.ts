import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestTargets, parseRepRange, incrementForEquipment, assessAgainstLastTime, DEFAULT_WEIGHT_INCREMENT_KG } from "./progression.js";
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
  assert.equal(t.suggestedWeightKg, 50 + incrementForEquipment("machine", 50));
  assert.deepEqual(t.targetReps, [6, 6, 6]);
  assert.deepEqual(t.targetWeights, [57, 57, 57]);
});

test("incrementForEquipment: barbell is a flat plate jump; dumbbell and machine/cable step up past a real-world rack/stack threshold; unset falls back to the default", () => {
  assert.equal(incrementForEquipment("barbell", 20), 2.5);
  assert.equal(incrementForEquipment("barbell", 100), 2.5);
  // Dumbbell racks stock ~1kg steps up to ~10kg, ~2kg steps above.
  assert.equal(incrementForEquipment("dumbbell", 8), 1);
  assert.equal(incrementForEquipment("dumbbell", 10), 2);
  assert.equal(incrementForEquipment("dumbbell", 20), 2);
  // Pin-loaded stacks (machine/cable) step ~10lb (~4.5kg) below ~50lb
  // (~22.5kg) of total stack, ~15lb (~7kg) above it.
  assert.equal(incrementForEquipment("machine", 20), 4.5);
  assert.equal(incrementForEquipment("machine", 22.5), 7);
  assert.equal(incrementForEquipment("machine", 30), 7);
  assert.equal(incrementForEquipment("cable", 20), 4.5);
  assert.equal(incrementForEquipment("cable", 30), 7);
  assert.equal(incrementForEquipment("bodyweight", 20), DEFAULT_WEIGHT_INCREMENT_KG);
  assert.equal(incrementForEquipment("other", 20), DEFAULT_WEIGHT_INCREMENT_KG);
  assert.equal(incrementForEquipment(null, 20), DEFAULT_WEIGHT_INCREMENT_KG);
});

test("weight-increase suggestion uses the exercise's own equipment type, not a flat constant", () => {
  const barbellSquat: Exercise = { ...exercise, equipmentType: "barbell" };
  const dumbbellCurl: Exercise = { ...exercise, equipmentType: "dumbbell" };
  const atCeiling = logs([[50, 10], [50, 10], [50, 11]]);
  assert.equal(suggestTargets(barbellSquat, atCeiling).suggestedWeightKg, 52.5);
  // 50kg is past the dumbbell rack's ~10kg step-up threshold -> +2kg.
  assert.equal(suggestTargets(dumbbellCurl, atCeiling).suggestedWeightKg, 52);
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
  assert.equal(t.suggestedWeightKg, 50 + incrementForEquipment("machine", 50));
  assert.deepEqual(t.targetReps, [6, 6, 6]);
  assert.deepEqual(t.targetWeights, [57, 57, 57]);
});

test("fixed rep target (min===max, a 'reps to failure' plan, not a real range): all sets clearing it increases weight, same as a real ceiling", () => {
  // User-reported scenario: 84kg for 12/10/9 against an exercise whose
  // repRange is the single number "8" (a to-failure target). All three
  // sets cleared 8, so bumping weight is the right call here — this
  // pins down that the fix below doesn't break the case it was actually
  // meant to still handle correctly.
  const toFailure: Exercise = { ...exercise, repRange: "8" };
  const t = suggestTargets(toFailure, logs([[84, 12], [84, 10], [84, 9]]));
  assert.equal(t.reason, "increase_weight");
  assert.equal(t.suggestedWeightKg, 84 + incrementForEquipment("machine", 84));
  assert.deepEqual(t.targetReps, [8, 8, 8]);
  assert.deepEqual(t.targetWeights, [91, 91, 91]);
});

test("fixed rep target: only the FIRST set clearing it must not alone trigger a weight increase (the actual bug)", () => {
  // Same "8 reps to failure" plan, but this time only the freshest set
  // cleared 8 — sets 2-3 didn't. For a real range, "first set clears the
  // ceiling" is enough (later sets fatiguing is expected). For a fixed
  // to-failure target it isn't: one early clear on a naturally variable
  // to-failure count doesn't mean the weight's outgrown, so this must
  // fall through to the ordinary +1-nudge path instead of jumping weight.
  const toFailure: Exercise = { ...exercise, repRange: "8" };
  const t = suggestTargets(toFailure, logs([[84, 12], [84, 7], [84, 6]]));
  assert.notEqual(t.reason, "increase_weight");
  assert.equal(t.suggestedWeightKg, 84);
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

test("real regression: a computed +1 nudge never climbs above the same-weight set before it (GYM feedback: '9 then 10 then 10 doesn't make sense')", () => {
  // All three sets at the same weight last time, but set 1 happened to
  // log fewer reps than sets 2-3 (8, 9, 9). Read independently, each
  // set's own +1 nudge would suggest 9, 10, 10 — reps climbing across
  // the session, which is backward (fatigue holds or drops capacity, it
  // doesn't increase it). Each computed nudge clamps to no more than the
  // same-weight set before it, so the actual suggestion is 9, 9, 9.
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const t = suggestTargets(wideRange, logs([[43, 8], [43, 9], [43, 9]]));
  assert.equal(t.reason, "add_reps");
  assert.equal(t.suggestedWeightKg, 43);
  assert.deepEqual(t.targetReps, [9, 9, 9]);
  assert.deepEqual(t.targetWeights, [43, 43, 43]);
});

test("the same-weight clamp never touches a set that legitimately already exceeded the ceiling — only computed nudges are clamped, never a real held value", () => {
  // Set 3 genuinely hit 11 reps against a 10 ceiling — a real, already-
  // earned number that must never be walked backward, even to keep the
  // sequence non-increasing. This is the same fixture as the
  // "non-first set... holds there" test above, re-asserted here to pin
  // down that the new same-weight clamp doesn't regress it.
  const t = suggestTargets(exercise, logs([[50, 6], [50, 6], [50, 11]]));
  assert.deepEqual(t.targetReps, [7, 7, 11]);
});

// --- overrideWeightKg: a saved weight preference forces the weight, reps stay math (see decideWeight.ts) ---

test("override holds the weight the deterministic rules would have increased, and progresses reps at it (the leg-curl bug)", () => {
  // 84kg x 12/10/9 against 8-12 would normally jump to 91kg x 8,8,8. With a
  // "stay at 84" preference the component must show 84 with reps progressed
  // off what was actually done there (12 is already the ceiling; 10->11, 9->10).
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const def = suggestTargets(wideRange, logs([[84, 12], [84, 10], [84, 9]]));
  assert.equal(def.reason, "increase_weight");
  assert.equal(def.suggestedWeightKg, 91);

  const held = suggestTargets(wideRange, logs([[84, 12], [84, 10], [84, 9]]), 84);
  assert.equal(held.suggestedWeightKg, 84);
  assert.deepEqual(held.targetWeights, [84, 84, 84]);
  assert.deepEqual(held.targetReps, [12, 11, 10]);
});

test("override snaps to an actual logged weight when it's within a step (float/unit round-trip tolerance)", () => {
  // A hold decided as 83.9kg (a lb round-trip of the same rung) must snap to
  // the logged 84 so the per-set history at that weight is recognized.
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const t = suggestTargets(wideRange, logs([[84, 12], [84, 10], [84, 9]]), 83.9);
  assert.equal(t.suggestedWeightKg, 84);
  assert.deepEqual(t.targetReps, [12, 11, 10]);
});

test("override to a genuinely lighter weight with no history there starts reps at the range floor (a deload)", () => {
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const t = suggestTargets(wideRange, logs([[84, 12], [84, 10], [84, 9]]), 70);
  assert.equal(t.suggestedWeightKg, 70);
  assert.deepEqual(t.targetWeights, [70, 70, 70]);
  assert.deepEqual(t.targetReps, [8, 8, 8]);
});

test("override is ignored when non-positive — falls through to normal deterministic behavior", () => {
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const t = suggestTargets(wideRange, logs([[84, 12], [84, 10], [84, 9]]), 0);
  assert.equal(t.reason, "increase_weight");
  assert.equal(t.suggestedWeightKg, 91);
});

test("override NEVER walks a real set backward: a floored no-history lead set must not clamp later real sets down", () => {
  // Reverse-pyramid last time (set 1 lighter at 70, sets 2-3 at 84), holding
  // at 84. Set 1 has no history at 84 -> range floor (8). Sets 2/3 have real
  // history at 84 (10, 9) -> progress to 11, 10. The floor-8 lead set must NOT
  // clamp them down to 8/8 (the bug). Set 1 stays 8, sets 2/3 keep 11/10.
  const wideRange: Exercise = { ...exercise, repRange: "8-12" };
  const t = suggestTargets(wideRange, logs([[70, 12], [84, 10], [84, 9]]), 84);
  assert.equal(t.suggestedWeightKg, 84);
  assert.deepEqual(t.targetWeights, [84, 84, 84]);
  assert.deepEqual(t.targetReps, [8, 11, 10]);
});

test("override still clamps between two REAL same-weight sets (ascending real reps don't survive)", () => {
  // Both sets have real history at 84; set 2's +1 nudge (10->11) shouldn't
  // exceed set 1's target (8->9). Clamp keeps the sequence non-increasing.
  const wideRange: Exercise = { ...exercise, repRange: "8-12", sets: 2 };
  const t = suggestTargets(wideRange, logs([[84, 8], [84, 10]]), 84);
  assert.deepEqual(t.targetReps, [9, 9]);
});

// --- assessAgainstLastTime: honest acknowledgment must not celebrate a regression ---

test("fewer total reps at the same weight -> 'below' (the rope-pushdown bug: 18x8/8/8 after 18x10/9/9)", () => {
  const v = assessAgainstLastTime(
    [{ weightKg: 18, reps: 8 }, { weightKg: 18, reps: 8 }, { weightKg: 18, reps: 8 }],
    logs([[18, 10], [18, 9], [18, 9]]),
  );
  assert.equal(v, "below");
});

test("a lighter top weight than last time -> 'below' even if reps are higher", () => {
  const v = assessAgainstLastTime(
    [{ weightKg: 16, reps: 15 }, { weightKg: 16, reps: 15 }],
    logs([[18, 8], [18, 8]]),
  );
  assert.equal(v, "below");
});

test("matching or beating last time -> 'met_or_beat'", () => {
  assert.equal(
    assessAgainstLastTime([{ weightKg: 18, reps: 10 }, { weightKg: 18, reps: 9 }, { weightKg: 18, reps: 9 }], logs([[18, 10], [18, 9], [18, 9]])),
    "met_or_beat",
  );
  assert.equal(
    assessAgainstLastTime([{ weightKg: 20, reps: 8 }], logs([[18, 12]])),
    "met_or_beat",
  );
});

test("no comparable history -> 'unknown' (nothing to be honest or dishonest about)", () => {
  assert.equal(assessAgainstLastTime([{ weightKg: 18, reps: 8 }], []), "unknown");
  assert.equal(assessAgainstLastTime([{ weightKg: 18, reps: 8 }], logs([[0, 8]])), "unknown");
});

test("verdict is set-count invariant: fewer sets but more reps each is 'met_or_beat', not a false 'below'", () => {
  // Last time 4 sets at 18 (10/10/10/8, avg 9.5); today 3 sets at 18
  // (12/12/11, avg 11.67). A raw-total comparison (35 < 38) would wrongly say
  // "below" though every set improved. Average-per-set gets it right.
  const v = assessAgainstLastTime(
    [{ weightKg: 18, reps: 12 }, { weightKg: 18, reps: 12 }, { weightKg: 18, reps: 11 }],
    logs([[18, 10], [18, 10], [18, 10], [18, 8]]),
  );
  assert.equal(v, "met_or_beat");
});

test("verdict is set-count invariant: more sets but fewer reps each is 'below', not a false win", () => {
  // Last time stopped early at 2 sets (8/8, avg 8); today 3 sets (7/7/7,
  // avg 7). Raw total (21 > 16) would praise a per-set regression.
  const v = assessAgainstLastTime(
    [{ weightKg: 18, reps: 7 }, { weightKg: 18, reps: 7 }, { weightKg: 18, reps: 7 }],
    logs([[18, 8], [18, 8]]),
  );
  assert.equal(v, "below");
});
