// Tests for the nightly memory job (NH-63). Run: deno test --no-config supabase/functions/
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import type { MemoryWrite } from "../_shared/memory-extraction.ts";
import type { FactDoc } from "../_shared/memory-scoring.ts";
import { handleMemoryRun, type MemoryDeps, type MemorySources } from "./handler.ts";

const NOW = new Date("2026-10-11T00:05:00Z");
const fact = (text: string, category: FactDoc["category"] = "preference"): FactDoc => ({
  text,
  category,
  importance: 3,
  stability: "long_term",
  evidence: "explicit",
  expires_at: null,
  first_seen_at: "2026-10-01T00:00:00Z",
  last_seen_at: "2026-10-01T00:00:00Z",
  mention_count: 1,
  source_message_ids: [],
});

const WITH_MESSAGES: MemorySources = {
  watermark: null,
  new_watermark: "2026-10-10T18:00:00Z",
  language: "en",
  facts: [{ id: "f-id", doc: fact("Trains before work", "schedule"), pinned: false }],
  messages: [
    { id: "m-a", role: "user", channel: "chat", text: "My new gym has no barbells", at: "2026-10-10T17:00:00Z" },
    { id: "m-b", role: "coach", channel: "chat", text: "Dumbbells then", at: "2026-10-10T18:00:00Z" },
  ],
};
const QUIET: MemorySources = { ...WITH_MESSAGES, new_watermark: null, messages: [] };
const MODEL_REPLY = JSON.stringify({
  operations: [
    { op: "add", text: "Gym has no barbells", category: "equipment", importance: 4, stability: "long_term", evidence: "explicit", messages: ["m1"] },
    { op: "reinforce", fact: "f1" },
    { op: "expire", fact: "f7" },
  ],
});

function deps(overrides: Partial<MemoryDeps> = {}, sourcesByUser: Record<string, MemorySources> = { u1: WITH_MESSAGES }) {
  const log = {
    applied: [] as Array<{ userId: string; write: MemoryWrite; watermark: string | null }>,
    failed: [] as Array<[string, string]>,
    spend: [] as unknown[],
    prompts: [] as Array<[string, string]>,
    events: [] as Array<[string, Record<string, unknown>]>,
  };
  let clock = 0;
  const d: MemoryDeps = {
    authorized: (req) => req.headers.get("x-cron-secret") === "s".repeat(32),
    due: () => Promise.resolve(Object.keys(sourcesByUser)),
    sources: (u) => Promise.resolve(sourcesByUser[u]),
    spendAllowed: () => Promise.resolve(true),
    extract: (system, user) => {
      log.prompts.push([system, user]);
      return Promise.resolve({ content: MODEL_REPLY, usage: { tokensInput: 2000, tokensOutput: 400 } });
    },
    recordSpend: (usage) => (log.spend.push(usage), Promise.resolve(1)),
    apply: (userId, write, watermark) => (log.applied.push({ userId, write, watermark }), Promise.resolve({})),
    markFailed: (userId, error) => (log.failed.push([userId, error]), Promise.resolve()),
    now: () => NOW,
    elapsedMs: () => (clock += 10),
    budgetMs: 100_000,
    batch: 50,
    log: (event, fields) => log.events.push([event, fields]),
    ...overrides,
  };
  return { d, log };
}

const cron = () => new Request("https://example.test/functions/v1/memory-nightly", { method: "POST", headers: { "x-cron-secret": "s".repeat(32) } });
const run = async (d: MemoryDeps) => (await (await handleMemoryRun(cron(), d)).json()).summary;

Deno.test("a user who wrote something gets operations applied, with the new watermark and the spend recorded", async () => {
  const { d, log } = deps();
  const s = await run(d);
  assertEquals([s.processed, s.updated, s.failed, s.dropped_operations], [1, 1, 0, 1], "the invented f7 is dropped");
  assertEquals(log.spend, [{ tokensInput: 2000, tokensOutput: 400 }]);
  const a = log.applied[0];
  assertEquals(a.watermark, "2026-10-10T18:00:00Z");
  assertEquals(a.write.insert.map((i) => i.doc.text), ["Gym has no barbells"]);
  assertEquals(a.write.insert[0].doc.source_message_ids, ["m-a"]);
  assertEquals(a.write.update.find((u) => u.id === "f-id")?.doc?.mention_count, 2);
  assertMatch(log.prompts[0][1], /^f1 \[schedule, importance 3, long_term\] Trains before work$/m);
});

Deno.test("a user who wrote nothing is refreshed without calling the model", async () => {
  const { d, log } = deps({}, { u1: QUIET });
  const s = await run(d);
  assertEquals([s.refreshed, s.updated], [1, 0]);
  assertEquals(log.prompts.length, 0);
  assertEquals(log.spend.length, 0);
  assertEquals(log.applied[0].watermark, null, "the watermark stays where it was");
});

Deno.test("only the coach's messages are new: no model call, but the watermark moves past them", async () => {
  const coachOnly: MemorySources = { ...WITH_MESSAGES, messages: [WITH_MESSAGES.messages[1]] };
  const { d, log } = deps({}, { u1: coachOnly });
  assertEquals((await run(d)).refreshed, 1);
  assertEquals(log.prompts.length, 0);
  assertEquals(log.applied[0].watermark, "2026-10-10T18:00:00Z");
});

Deno.test("output that isn't JSON fails that user for today — charged, nothing applied", async () => {
  const { d, log } = deps({ extract: () => Promise.resolve({ content: "I think the user likes dumbbells.", usage: { tokensInput: 10, tokensOutput: 5 } }) });
  const s = await run(d);
  assertEquals(s.failed, 1);
  assertEquals(log.applied.length, 0);
  assertEquals(log.spend.length, 1);
  assertMatch(log.failed[0][1], /^extraction: /);
});

Deno.test("a model error: charged when tokens may have been spent, not otherwise", async () => {
  for (const [spent, charged] of [[true, 1], [false, 0]] as const) {
    const { d, log } = deps({ extract: () => Promise.reject(Object.assign(new Error("boom"), { spent })) });
    assertEquals((await run(d)).failed, 1);
    assertEquals(log.spend.length, charged, `spent=${spent}`);
    assertMatch(log.failed[0][1], /^model: /);
  }
});

Deno.test("a failed apply fails that user and moves on to the next", async () => {
  const { d, log } = deps(
    { apply: (u) => (u === "u1" ? Promise.reject(new Error("cap")) : Promise.resolve({})) },
    { u1: WITH_MESSAGES, u2: QUIET },
  );
  const s = await run(d);
  assertEquals([s.processed, s.failed, s.refreshed], [2, 1, 1]);
  assertMatch(log.failed[0][1], /^apply: /);
});

Deno.test("the run stops at the spend ceiling, leaving the rest for later", async () => {
  let calls = 0;
  const { d } = deps({ spendAllowed: () => Promise.resolve(++calls < 2) }, { u1: WITH_MESSAGES, u2: WITH_MESSAGES, u3: WITH_MESSAGES });
  const s = await run(d);
  assertEquals([s.processed, s.stopped], [1, "spend_ceiling"]);
});

Deno.test("the run stops starting users when its time budget is spent", async () => {
  const { d } = deps({ budgetMs: 25 }, { u1: QUIET, u2: QUIET, u3: QUIET, u4: QUIET });
  const s = await run(d);
  assertEquals(s.stopped, "time_budget");
  assertEquals(s.processed < 4, true);
});

Deno.test("an unreadable stored fact is left out rather than guessed at", async () => {
  const broken: MemorySources = { ...QUIET, facts: [...QUIET.facts, { id: "bad", doc: { text: "x" } as unknown as FactDoc, pinned: false }] };
  const { d, log } = deps({}, { u1: broken });
  await run(d);
  const touched = [...log.applied[0].write.update.map((u) => u.id), ...log.applied[0].write.remove.map((r) => r.id)];
  assertEquals(touched.includes("bad"), false);
});

Deno.test("the run summary is logged with its duration", async () => {
  const { d, log } = deps();
  await run(d);
  const [event, fields] = log.events.at(-1)!;
  assertEquals(event, "memory_run");
  assertEquals(typeof fields.duration_ms, "number");
});

Deno.test("only the cron's secret gets in, and only by POST", async () => {
  const { d, log } = deps();
  assertEquals((await handleMemoryRun(new Request("https://example.test/", { method: "POST" }), d)).status, 401);
  assertEquals((await handleMemoryRun(new Request("https://example.test/", { method: "GET" }), d)).status, 405);
  assertEquals(log.applied.length, 0);
});

Deno.test("attempts the client retried after they may have spent are charged too", async () => {
  const { d, log } = deps({ extract: () => Promise.resolve({ content: MODEL_REPLY, usage: { tokensInput: 2000, tokensOutput: 400 }, retriedSpent: 2 }) });
  assertEquals((await run(d)).updated, 1);
  assertEquals(log.spend, [undefined, undefined, { tokensInput: 2000, tokensOutput: 400 }]);
  const failing = deps({ extract: () => Promise.reject(Object.assign(new Error("token factory 502"), { spent: true, retriedSpent: 1 })) });
  assertEquals((await run(failing.d)).failed, 1);
  assertEquals(failing.log.spend, [undefined, undefined]);
});
