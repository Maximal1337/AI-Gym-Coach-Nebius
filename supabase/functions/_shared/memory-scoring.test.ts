// Unit tests for NH-62. Run: deno test --no-config supabase/functions/_shared/
import { assert, assertAlmostEquals, assertEquals, assertFalse, assertThrows } from "jsr:@std/assert@1";
import {
  type FactDoc,
  isExpired,
  isValidFactDoc,
  MAX_FACTS,
  MAX_PINNED,
  planMemory,
  recency,
  reinforcement,
  scoreFact,
  type StoredFact,
} from "./memory-scoring.ts";

const NOW = new Date("2026-10-10T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function doc(overrides: Partial<FactDoc> = {}): FactDoc {
  return {
    text: "Prefers dumbbells over the barbell",
    category: "preference",
    importance: 3,
    stability: "long_term",
    evidence: "explicit",
    expires_at: null,
    first_seen_at: daysAgo(10),
    last_seen_at: daysAgo(0),
    mention_count: 1,
    source_message_ids: ["m1"],
    ...overrides,
  };
}

function stored(id: string, overrides: Partial<FactDoc> = {}, pinned = false): StoredFact {
  return { id, doc: doc({ text: `fact ${id}`, ...overrides }), pinned };
}

/** 15 stored facts, all scoring 0.8: 5/5 × other 0.7, no decay, + 0.1 for one mention. */
function fullMemory(): StoredFact[] {
  return Array.from({ length: MAX_FACTS }, (_, i) =>
    stored(`f-${String(i).padStart(2, "0")}`, { category: "other", importance: 5, stability: "permanent" })
  );
}

// ------------------------------------------------------------ scoring

Deno.test("score: importance × weight × confidence × recency + reinforcement", () => {
  // 5/5 × 1.5 × 1.0 × 1 + 0.1 × log2(2)
  assertEquals(scoreFact(doc({ category: "health", importance: 5, stability: "permanent" }), NOW), 1.6);
  // 3/5 × 0.9 × 0.6 × 0.5 (one half-life) + 0.1
  assertEquals(
    scoreFact(doc({ importance: 3, evidence: "inferred", stability: "long_term", last_seen_at: daysAgo(60) }), NOW),
    0.262,
  );
});

Deno.test("score: category weights order health > goal > schedule = equipment > preference > other", () => {
  const s = (category: FactDoc["category"]) => scoreFact(doc({ category, stability: "permanent" }), NOW);
  assert(s("health") > s("goal"));
  assert(s("goal") > s("schedule"));
  assertEquals(s("schedule"), s("equipment"));
  assert(s("equipment") > s("preference"));
  assert(s("preference") > s("other"));
});

Deno.test("recency: half-lives of 7 and 60 days; permanent never decays", () => {
  assertAlmostEquals(recency(doc({ stability: "temporary", last_seen_at: daysAgo(7) }), NOW), 0.5, 1e-12);
  assertAlmostEquals(recency(doc({ stability: "temporary", last_seen_at: daysAgo(14) }), NOW), 0.25, 1e-12);
  assertAlmostEquals(recency(doc({ stability: "long_term", last_seen_at: daysAgo(120) }), NOW), 0.25, 1e-12);
  assertEquals(recency(doc({ stability: "permanent", last_seen_at: daysAgo(3650) }), NOW), 1);
});

Deno.test("recency: a last_seen_at in the future counts as now", () => {
  assertEquals(recency(doc({ last_seen_at: daysAgo(-5) }), NOW), 1);
});

Deno.test("reinforcement: 0.1 × log2(1 + mentions), capped at 0.3", () => {
  assertAlmostEquals(reinforcement(1), 0.1, 1e-12);
  assertAlmostEquals(reinforcement(3), 0.2, 1e-12);
  assertAlmostEquals(reinforcement(7), 0.3, 1e-12);
  assertEquals(reinforcement(100), 0.3);
  assertEquals(reinforcement(0), 0);
});

Deno.test("score is rounded to 6 decimals, the precision of user_facts.score", () => {
  const s = scoreFact(doc({ stability: "temporary", last_seen_at: daysAgo(3) }), NOW);
  assertEquals(s, Math.round(s * 1e6) / 1e6);
});

Deno.test("an invalid timestamp throws instead of scoring as NaN", () => {
  assertThrows(() => scoreFact(doc({ last_seen_at: "yesterday" }), NOW));
});

Deno.test("expiry: a fact expires at its expires_at, not a millisecond earlier", () => {
  assert(isExpired(doc({ expires_at: NOW.toISOString() }), NOW));
  assertFalse(isExpired(doc({ expires_at: new Date(NOW.getTime() + 1).toISOString() }), NOW));
  assertFalse(isExpired(doc({ expires_at: null }), NOW));
});

// ------------------------------------------------------------ validation

Deno.test("isValidFactDoc accepts a well-formed document", () => {
  assert(isValidFactDoc(doc()));
  assert(isValidFactDoc(doc({ expires_at: daysAgo(-3), text: "x".repeat(140) })));
});

Deno.test("isValidFactDoc rejects malformed documents", () => {
  const bad: unknown[] = [
    null,
    [],
    "text",
    { ...doc(), text: "" },
    { ...doc(), text: "   " },
    { ...doc(), text: "x".repeat(141) },
    { ...doc(), category: "mood" },
    { ...doc(), importance: 0 },
    { ...doc(), importance: 6 },
    { ...doc(), importance: 2.5 },
    { ...doc(), importance: "3" },
    { ...doc(), stability: "forever" },
    { ...doc(), evidence: "rumor" },
    { ...doc(), expires_at: "someday" },
    { ...doc(), last_seen_at: undefined },
    { ...doc(), mention_count: 0 },
    { ...doc(), source_message_ids: [1] },
  ];
  for (const d of bad) assertFalse(isValidFactDoc(d), JSON.stringify(d));
});

// ------------------------------------------------------------ eviction

Deno.test("rule 1: expired stored facts are removed; expired candidates are rejected", () => {
  const plan = planMemory(
    [stored("a", { expires_at: daysAgo(1) }), stored("b")],
    [doc({ text: "old news", expires_at: daysAgo(0) })],
    NOW,
  );
  assertEquals(plan.remove, [{ id: "a", reason: "expired" }]);
  assertEquals(plan.keep.map((k) => k.id), ["b"]);
  assertEquals(plan.insert, []);
  assertEquals(plan.rejected.map((r) => r.doc.text), ["old news"]);
});

Deno.test("rule 2: below the cap, the 15th fact is inserted", () => {
  const plan = planMemory(fullMemory().slice(0, MAX_FACTS - 1), [doc({ text: "15th", category: "other", importance: 1 })], NOW);
  assertEquals(plan.insert.map((i) => i.doc.text), ["15th"]);
  assertEquals(plan.remove, []);
  assertEquals(plan.keep.length + plan.insert.length, MAX_FACTS);
});

Deno.test("rule 3: at the cap, a higher-scoring 16th fact evicts the lowest unpinned one", () => {
  const facts = fullMemory();
  facts[7] = stored("f-07", { category: "other", importance: 1, stability: "permanent" }); // the weakest
  const plan = planMemory(facts, [doc({ text: "strong", category: "goal", importance: 5, stability: "permanent" })], NOW);
  assertEquals(plan.remove, [{ id: "f-07", reason: "evicted" }]);
  assertEquals(plan.insert.map((i) => i.doc.text), ["strong"]);
  assertEquals(plan.keep.length + plan.insert.length, MAX_FACTS);
});

Deno.test("rule 3: at the cap, an equal-scoring 16th fact is rejected (strictly higher only)", () => {
  const candidate = doc({ text: "same", category: "other", importance: 5, stability: "permanent" });
  const plan = planMemory(fullMemory(), [candidate], NOW);
  assertEquals(scoreFact(candidate, NOW), scoreFact(fullMemory()[0].doc, NOW));
  assertEquals(plan.insert, []);
  assertEquals(plan.remove, []);
  assertEquals(plan.rejected.map((r) => r.doc.text), ["same"]);
});

Deno.test("rule 3: at the cap, a lower-scoring 16th fact is rejected", () => {
  const plan = planMemory(fullMemory(), [doc({ text: "weak", category: "other", importance: 1 })], NOW);
  assertEquals(plan.insert, []);
  assertEquals(plan.rejected.length, 1);
  assertEquals(plan.keep.length, MAX_FACTS);
});

Deno.test("rule 3: several candidates — the best ones get in, the rest are rejected", () => {
  const facts = fullMemory();
  facts[3] = stored("f-03", { category: "other", importance: 1, stability: "permanent" });
  facts[9] = stored("f-09", { category: "other", importance: 2, stability: "permanent" });
  const plan = planMemory(facts, [
    doc({ text: "goal A", category: "goal", importance: 5, stability: "permanent" }),
    doc({ text: "tiny", category: "other", importance: 1 }),
    doc({ text: "goal B", category: "goal", importance: 4, stability: "permanent" }),
  ], NOW);
  assertEquals(plan.remove.map((r) => r.id).sort(), ["f-03", "f-09"]);
  assertEquals(plan.insert.map((i) => i.doc.text), ["goal A", "goal B"]);
  assertEquals(plan.rejected.map((r) => r.doc.text), ["tiny"]);
  assertEquals(plan.keep.length + plan.insert.length, MAX_FACTS);
});

Deno.test("rule 4: pinned facts are never evicted, even when they score lowest", () => {
  const facts = fullMemory();
  facts[0] = stored("f-00", { category: "health", importance: 1, evidence: "inferred", stability: "temporary", last_seen_at: daysAgo(30) }, true);
  facts[5] = stored("f-05", { category: "other", importance: 4, stability: "permanent" });
  const plan = planMemory(facts, [doc({ text: "strong", category: "goal", importance: 5, stability: "permanent" })], NOW);
  assertEquals(plan.remove, [{ id: "f-05", reason: "evicted" }]);
  const pinnedWeak = plan.keep.find((k) => k.id === "f-00");
  assert(pinnedWeak?.pinned);
});

Deno.test("rule 4: a new health fact is pinned while fewer than 3 are", () => {
  const plan = planMemory(
    [stored("h1", { category: "health" }, true), stored("h2", { category: "health" }, true)],
    [doc({ text: "Knee pain on deep squats", category: "health", importance: 5 })],
    NOW,
  );
  assertEquals(plan.insert.map((i) => [i.doc.text, i.pinned]), [["Knee pain on deep squats", true]]);
});

Deno.test("rule 4: with 3 pins taken, a new health fact goes in unpinned (pins are sticky)", () => {
  const plan = planMemory(
    [1, 2, 3].map((n) => stored(`h${n}`, { category: "health", importance: 1 }, true)),
    [doc({ text: "Shoulder impingement", category: "health", importance: 5 })],
    NOW,
  );
  assertEquals(plan.insert.map((i) => [i.doc.text, i.pinned]), [["Shoulder impingement", false]]);
  assertEquals(plan.keep.filter((k) => k.pinned).length, MAX_PINNED);
});

Deno.test("rule 4: when a pinned fact expires, the best unpinned health fact takes the slot", () => {
  const plan = planMemory([
    stored("h1", { category: "health", expires_at: daysAgo(1) }, true),
    stored("h2", { category: "health" }, true),
    stored("h3", { category: "health" }, true),
    stored("h4", { category: "health", importance: 2 }),
    stored("h5", { category: "health", importance: 4 }),
  ], [], NOW);
  assertEquals(plan.remove, [{ id: "h1", reason: "expired" }]);
  const pinned = plan.keep.filter((k) => k.pinned).map((k) => k.id).sort();
  assertEquals(pinned, ["h2", "h3", "h5"]);
});

Deno.test("rule 4: a pin on a non-health fact, or a 4th pin, is dropped", () => {
  const plan = planMemory([
    stored("p1", { category: "preference" }, true),
    stored("h1", { category: "health", importance: 5 }, true),
    stored("h2", { category: "health", importance: 4 }, true),
    stored("h3", { category: "health", importance: 3 }, true),
    stored("h4", { category: "health", importance: 2 }, true),
  ], [], NOW);
  const pinned = plan.keep.filter((k) => k.pinned).map((k) => k.id).sort();
  assertEquals(pinned, ["h1", "h2", "h3"]);
});

Deno.test("ties: of two equally weak facts, the one seen longer ago is evicted", () => {
  const facts = fullMemory();
  facts[2] = stored("f-02", { category: "other", importance: 1, stability: "permanent", last_seen_at: daysAgo(1) });
  facts[4] = stored("f-04", { category: "other", importance: 1, stability: "permanent", last_seen_at: daysAgo(9) });
  const plan = planMemory(facts, [doc({ text: "new", category: "goal", importance: 5 })], NOW);
  assertEquals(plan.remove, [{ id: "f-04", reason: "evicted" }]);
});

Deno.test("ties: with equal score and recency, the higher id is evicted", () => {
  const facts = fullMemory();
  facts[2] = stored("f-02", { category: "other", importance: 1, stability: "permanent" });
  facts[4] = stored("f-04", { category: "other", importance: 1, stability: "permanent" });
  const plan = planMemory(facts, [doc({ text: "new", category: "goal", importance: 5 })], NOW);
  assertEquals(plan.remove, [{ id: "f-04", reason: "evicted" }]);
});

Deno.test("stored state over the cap is trimmed back to it", () => {
  const facts = [...fullMemory(), stored("f-99", { category: "other", importance: 1 })];
  const plan = planMemory(facts, [], NOW);
  assertEquals(plan.remove, [{ id: "f-99", reason: "evicted" }]);
  assertEquals(plan.keep.length, MAX_FACTS);
});

Deno.test("deterministic: same input, same plan; input order doesn't matter", () => {
  const facts = fullMemory();
  facts[1] = stored("f-01", { category: "other", importance: 1, stability: "permanent" });
  facts[6] = stored("f-06", { category: "health", importance: 2 }, true);
  const candidates = [
    doc({ text: "c1", category: "goal", importance: 5 }),
    doc({ text: "c2", category: "schedule", importance: 4 }),
    doc({ text: "c3", category: "other", importance: 1 }),
  ];
  const first = planMemory(facts, candidates, NOW);
  assertEquals(planMemory(facts, candidates, NOW), first);
  assertEquals(planMemory([...facts].reverse(), [...candidates].reverse(), NOW), first);
});

Deno.test("invariants hold for random memories: caps, pins, and a safe apply order", () => {
  let seed = 42;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const randomDoc = (text: string): FactDoc =>
    doc({
      text,
      category: pick(["health", "goal", "schedule", "equipment", "preference", "other"] as const),
      importance: 1 + Math.floor(rand() * 5),
      stability: pick(["temporary", "long_term", "permanent"] as const),
      evidence: pick(["explicit", "inferred"] as const),
      expires_at: rand() < 0.15 ? daysAgo(Math.floor(rand() * 20) - 10) : null,
      last_seen_at: daysAgo(Math.floor(rand() * 90)),
      mention_count: 1 + Math.floor(rand() * 8),
    });

  for (let run = 0; run < 500; run++) {
    const storedFacts: StoredFact[] = [];
    let pins = 0;
    for (let i = 0, n = Math.floor(rand() * (MAX_FACTS + 1)); i < n; i++) {
      const d = randomDoc(`s${run}-${i}`);
      const pinned = d.category === "health" && pins < MAX_PINNED && rand() < 0.7;
      if (pinned) pins++;
      storedFacts.push({ id: `id-${String(i).padStart(3, "0")}`, doc: d, pinned });
    }
    const candidates = Array.from({ length: Math.floor(rand() * 6) }, (_, i) => randomDoc(`c${run}-${i}`));
    const plan = planMemory(storedFacts, candidates, NOW);

    const final = [...plan.keep, ...plan.insert];
    assert(final.length <= MAX_FACTS, `run ${run}: ${final.length} facts`);
    assert(final.filter((f) => f.pinned).length <= MAX_PINNED, `run ${run}: too many pins`);
    for (const i of plan.insert) if (i.pinned) assertEquals(i.doc.category, "health");

    // Every stored fact is either kept or removed, never both.
    const removed = new Set(plan.remove.map((r) => r.id));
    const kept = new Set(plan.keep.map((k) => k.id));
    assertEquals(removed.size + kept.size, storedFacts.length, `run ${run}: stored facts unaccounted for`);
    for (const id of kept) assertFalse(removed.has(id));
    // Every candidate is either inserted or rejected.
    assertEquals(plan.insert.length + plan.rejected.length, candidates.length, `run ${run}: candidates unaccounted for`);
    // A pinned stored fact only ever leaves by expiring.
    for (const f of storedFacts) {
      if (f.pinned && removed.has(f.id)) {
        assertEquals(plan.remove.find((r) => r.id === f.id)?.reason, "expired", `run ${run}: pinned ${f.id} evicted`);
      }
    }
    // The apply order (remove → insert → update) never passes through a state
    // over the caps, so the database triggers never fire.
    const afterRemove = storedFacts.filter((f) => !removed.has(f.id));
    assert(afterRemove.length + plan.insert.length <= MAX_FACTS, `run ${run}: insert would exceed the cap`);
    const pinsDuringInsert = afterRemove.filter((f) => f.pinned).length + plan.insert.filter((i) => i.pinned).length;
    assert(pinsDuringInsert <= MAX_PINNED, `run ${run}: insert would exceed the pin cap`);
  }
});
