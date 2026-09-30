import { test } from "node:test";
import assert from "node:assert/strict";
import { type BenchDeps, costUsd, parseArgs, percentile, renderColdStarts, renderTurns, resolveTarget, runColdStart, runTurns, SCRIPT } from "./bench.js";
import { HermesError } from "./hermes.js";
import type { JobContext } from "./outbox.js";
import { sandboxApiKey, sandboxName } from "./sandbox-manager.js";

const endpoint = { baseUrl: "http://sandbox:8642", apiKey: "k" };
const prices = { in: 0.3, out: 0.9 };

/** A clock that only moves when a fake call says so. */
function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("percentile: nearest rank; nothing for no values", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 95), 5);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 50), undefined);
});

test("costUsd: per 1M tokens; unknown without usage", () => {
  assert.equal(costUsd({ tokensIn: 1000, tokensOut: 100 }, prices), 0.00039);
  assert.equal(costUsd({}, prices), undefined);
});

test("runTurns: the scripted conversation, each turn with the history before it, one session", async () => {
  const c = clock();
  const seen: Array<{ job: JobContext; sessionKey: string }> = [];
  const deps: BenchDeps = {
    now: c.now,
    sleep: async () => {},
    chat: async (_endpoint, job, sessionKey) => {
      seen.push({ job, sessionKey });
      c.advance(2_000);
      return { text: `reply ${seen.length}`, usage: { tokensInput: 1_000, tokensOutput: 100 } };
    },
  };
  const turns = await runTurns(deps, endpoint, "user-1", "bench-user-1");
  assert.equal(turns.length, SCRIPT.length);
  assert.ok(turns.every((t) => t.ok && t.ms === 2_000));
  assert.ok(seen.every((s) => s.sessionKey === "bench-user-1" && s.job.job.user_id === "user-1"));
  // The fourth message sees three exchanges; the check-in comes last, without a message.
  assert.equal(seen[3].job.history.length, 6);
  assert.deepEqual(seen[3].job.history.slice(-2).map((h) => h.text), [SCRIPT[2].text, "reply 3"]);
  const last = seen.at(-1)!.job;
  assert.equal(last.job.kind, "checkin");
  assert.equal(last.message, null);
  assert.equal(last.facts.length, 5);
});

test("runTurns: a failed turn is recorded and the conversation goes on", async () => {
  const c = clock();
  let calls = 0;
  const deps: BenchDeps = {
    now: c.now,
    sleep: async () => {},
    chat: async (_endpoint, job) => {
      calls++;
      c.advance(1_000);
      if (calls === 2) throw new HermesError("hermes returned an empty reply", true);
      return { text: `ok ${job.history.length}` };
    },
  };
  const turns = await runTurns(deps, endpoint, "u", "s");
  assert.equal(turns[1].ok, false);
  assert.match(turns[1].error!, /empty reply/);
  // Turn 3 sees turn 1's exchange and turn 2's question, but no reply to it.
  assert.equal(turns[2].reply, "ok 3");
});

test("renderTurns: the table, p50/p95 and the cost per 10 turns against O-04", () => {
  const turns = SCRIPT.map((step, i) => ({
    index: i + 1,
    kind: step.kind,
    text: step.text,
    ms: (i + 1) * 1_000,
    ok: true,
    reply: "Sure | here",
    tokensIn: 3_000,
    tokensOut: 200,
  }));
  const report = renderTurns(turns, prices, "test");
  assert.match(report, /^\| 10 \| \(daily check-in\) \| 10\.0 s \| 3000 → 200 \| \$0\.0011 \| ✅ Sure \\\| here \|$/m);
  assert.match(report, /\*\*p50 5\.0 s, p95 10\.0 s\*\* — p95 ≤ 15 s: ✅/);
  assert.match(report, /\*\*Per 10 turns: \$0\.0108\*\* at \$0\.3 \/ \$0\.9 per 1M tokens — ≤ \$0\.05: ✅/);
  assert.match(report, /\*\*Failed or empty replies: 0 of 10\*\*/);

  const slow = turns.map((t) => ({ ...t, ms: 20_000, tokensIn: undefined, tokensOut: undefined }));
  const bad = renderTurns(slow, prices, "slow", { table: false });
  assert.match(bad, /p95 ≤ 15 s: ❌/);
  assert.match(bad, /Per 10 turns: unknown/);
  assert.match(bad, /10 reply\(s\) came without usage/);
  assert.doesNotMatch(bad, /^\| 1 \|/m);
});

test("runColdStart: stop, start, then retry an unreachable Hermes until it answers", async () => {
  const c = clock();
  const calls: string[] = [];
  const driver = {
    stop: async (name: string) => { calls.push(`stop ${name}`); c.advance(5_000); },
    start: async (name: string) => { calls.push(`start ${name}`); c.advance(20_000); },
    serviceUrl: async (name: string, port: number) => `http://${name}.svc:${port}`,
  };
  let attempts = 0;
  const deps: BenchDeps = {
    now: c.now,
    sleep: async (ms) => { c.advance(ms); },
    chat: async (ep) => {
      assert.equal(ep.baseUrl, "http://sb.svc:8642");
      assert.equal(ep.apiKey, "key");
      c.advance(1_000);
      if (++attempts % 3 !== 0) throw new HermesError("hermes unreachable: ECONNREFUSED", false);
      return { text: "hi" };
    },
  };
  const runs = await runColdStart(deps, driver, "sb", "key", "u", 2);
  assert.deepEqual(calls, ["stop sb", "start sb", "stop sb", "start sb"]);
  assert.deepEqual(runs.map((r) => [r.ok, r.stopMs, r.readyMs, r.firstReplyMs]), [
    [true, 5_000, 20_000, 7_000],
    [true, 5_000, 20_000, 7_000],
  ]);
  assert.match(renderColdStarts(runs, "t"), /\*\*Worst 27\.0 s\*\* — ≤ 60 s: ✅/);
});

test("runColdStart: an error other than unreachable stops the run; a CLI failure is reported", async () => {
  const c = clock();
  const deps: BenchDeps = {
    now: c.now,
    sleep: async (ms) => { c.advance(ms); },
    chat: async () => { throw new HermesError("hermes 401: {}", false); },
  };
  const driver = { stop: async () => {}, start: async () => {}, serviceUrl: async () => "http://x:8642" };
  const [run] = await runColdStart(deps, driver, "sb", "key", "u", 1);
  assert.equal(run.ok, false);
  assert.match(run.error!, /401/);

  const broken = { ...driver, start: async () => { throw new Error("openshell sandbox start failed: quota"); } };
  const [failed] = await runColdStart(deps, broken, "sb", "key", "u", 1);
  assert.match(failed.error!, /quota/);
  assert.match(renderColdStarts([run, failed], "t"), /❌ a run failed/);
});

test("parseArgs: modes, options, and one target", () => {
  const a = parseArgs(["turns", "--user", "u1", "--price-in", "1", "--price-out", "3"]);
  assert.equal(a.mode, "turns");
  assert.equal(a.user, "u1");
  assert.deepEqual(a.prices, { in: 1, out: 3 });
  assert.deepEqual(parseArgs(["soak", "--sandbox", "sb", "--minutes", "5", "--every", "30"]).every, 30);
  assert.equal(parseArgs(["cold-start", "--sandbox", "sb", "--runs", "2"]).runs, 2);
  assert.equal(parseArgs(["turns", "--base-url", "http://h:8642/"]).baseUrl, "http://h:8642");
  assert.throws(() => parseArgs(["bogus"]), /usage/);
  assert.throws(() => parseArgs(["turns"]), /exactly one/);
  assert.throws(() => parseArgs(["turns", "--user", "u", "--sandbox", "s"]), /exactly one/);
  assert.throws(() => parseArgs(["cold-start", "--base-url", "http://h"]), /needs a sandbox/);
  assert.throws(() => parseArgs(["soak", "--sandbox", "s", "--minutes", "0"]), /positive/);
  assert.throws(() => parseArgs(["turns", "--sandbox", "s", "--verbose"]), /unknown/);
});

test("resolveTarget: the relay's own way to each sandbox, and its key", async () => {
  const url = async (name: string, port: number) => `http://${name}:${port}`;
  const secret = "s".repeat(32);

  const managed = resolveTarget(parseArgs(["turns", "--user", "u1"]), { RELAY_SANDBOXES: "manager", RELAY_ENV: "dev", SANDBOX_KEY_SECRET: secret }, url);
  const name = sandboxName("dev", "u1");
  assert.equal(managed.name, name);
  assert.deepEqual(await managed.endpoint(), { baseUrl: `http://${name}:8642`, apiKey: sandboxApiKey(secret, name) });

  const byName = resolveTarget(parseArgs(["cold-start", "--sandbox", "spike-1"]), { BENCH_API_KEY: "given" }, url);
  assert.deepEqual(await byName.endpoint(), { baseUrl: "http://spike-1:8642", apiKey: "given" });

  const fixed = resolveTarget(parseArgs(["turns", "--user", "u2"]), { RELAY_STATIC_SANDBOXES: JSON.stringify({ u2: { baseUrl: "http://10.42.0.9:8642", apiKey: "static" } }) }, url);
  assert.deepEqual(await fixed.endpoint(), { baseUrl: "http://10.42.0.9:8642", apiKey: "static" });

  assert.throws(() => resolveTarget(parseArgs(["turns", "--base-url", "http://h"]), {}, url), /BENCH_API_KEY/);
  assert.throws(() => resolveTarget(parseArgs(["turns", "--sandbox", "s"]), {}, url), /no key/);
  assert.throws(() => resolveTarget(parseArgs(["turns", "--user", "nobody"]), { RELAY_STATIC_SANDBOXES: "{}" }, url), /no RELAY_STATIC_SANDBOXES entry/);
});
