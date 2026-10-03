import { test } from "node:test";
import assert from "node:assert/strict";
import { chat, HermesError } from "./hermes.js";
import type { DeferRequest, DeliverRequest, FailRequest, JobContext } from "./outbox.js";
import { DELIVERY_MARGIN_MS, LEASE_SHORT_DEFER_SECONDS, processJob, type RelayDeps, runOnce, turnBudget } from "./relay.js";
import { staticAcquire, staticSandboxes } from "./sandboxes.js";

const ENDPOINT = { baseUrl: "http://10.42.0.17:8642", apiKey: "sandbox-key" };

function job(kind: "chat" | "checkin" = "chat", user = "u1"): JobContext {
  return {
    id: 7,
    lease_token: "lease-7",
    leased_until: "2026-10-10T08:03:00Z",
    job: { id: 7, kind, environment: "prod", user_id: user, attempts: 1 },
    message: kind === "chat" ? { id: "m1", text: "Any tips?", created_at: "2026-10-10T07:59:00Z" } : null,
    history: [],
    facts: [],
    user: { language: "en", units: "metric", coach_name: "Rex", tone: null },
    agent: { sandbox_name: "u-1", provisioned: true },
  };
}

function deps(overrides: Partial<RelayDeps> = {}) {
  const log = {
    delivered: [] as DeliverRequest[],
    failed: [] as FailRequest[],
    deferred: [] as DeferRequest[],
    chats: [] as unknown[][],
    events: [] as string[],
    released: 0,
  };
  const d: RelayDeps = {
    outbox: {
      claim: () => Promise.resolve({ jobs: [job()] }),
      deliver: (r) => {
        log.delivered.push(r);
        return Promise.resolve({ status: 200, body: {} });
      },
      fail: (r) => {
        log.failed.push(r);
        return Promise.resolve(true);
      },
      defer: (r) => {
        log.deferred.push(r);
        return Promise.resolve(true);
      },
    },
    acquireSandbox: () => Promise.resolve({ endpoint: ENDPOINT, release: () => void log.released++ }),
    chat: (...args) => {
      log.chats.push(args);
      return Promise.resolve({ text: "Rest 2 min. [Guide](https://example.org/rest)", usage: { tokensInput: 900, tokensOutput: 60 } });
    },
    model: "nvidia/nemotron-3-super",
    turnBudgetMs: 120_000 + DELIVERY_MARGIN_MS,
    now: () => new Date("2026-10-10T08:00:00Z"),
    log: (event) => log.events.push(event),
    ...overrides,
  };
  return { d, log };
}

test("a chat turn runs in the user's own sandbox and is delivered with usage and sources", async () => {
  const { d, log } = deps();
  assert.equal(await processJob(job(), d), "delivered");
  assert.equal(log.chats[0][0], ENDPOINT);
  assert.deepEqual(log.chats[0][2], { sessionKey: "u1" });
  assert.deepEqual(log.delivered, [{
    job_id: 7,
    lease_token: "lease-7",
    model: "nvidia/nemotron-3-super",
    usage: { tokensInput: 900, tokensOutput: 60 },
    // The app shows plain text: the link becomes its title, and a tappable source.
    reply: { text: "Rest 2 min. Guide", sources: [{ title: "Guide", url: "https://example.org/rest" }] },
  }]);
});

test("no ready sandbox: the job is deferred unspent, nothing is charged, nothing is shared", async () => {
  const { d, log } = deps({ acquireSandbox: () => Promise.resolve({ defer: 20, reason: "capacity" }) });
  assert.equal(await processJob(job(), d), "deferred");
  assert.equal(log.chats.length, 0);
  assert.deepEqual(log.deferred, [{ job_id: 7, lease_token: "lease-7", seconds: 20, reason: "capacity" }]);
  assert.equal(log.failed.length, 0);
});

test("a sandbox that can't be provided fails the attempt without charging it", async () => {
  const { d, log } = deps({ acquireSandbox: () => Promise.reject(new Error("record_agent: user_gone")) });
  assert.equal(await processJob(job(), d), "failed");
  assert.equal(log.chats.length, 0);
  assert.deepEqual(log.failed, [{ job_id: 7, lease_token: "lease-7", error: "sandbox_error: Error: record_agent: user_gone" }]);
});

test("the sandbox is released after the turn, whatever happened", async () => {
  for (const chat of [
    () => Promise.resolve({ text: "ok" }),
    () => Promise.reject(new HermesError("boom", true)),
  ]) {
    const { d, log } = deps({ chat });
    await processJob(job(), d);
    assert.equal(log.released, 1);
  }
  const { d, log } = deps({
    outbox: { ...deps().d.outbox, deliver: () => Promise.reject(new Error("down")), fail: () => Promise.reject(new Error("down")) },
  });
  await assert.rejects(() => processJob(job(), d));
  assert.equal(log.released, 1, "released even when reporting throws");
});

test("a failure after the model may have run is charged; one before it isn't", async () => {
  for (const [spent, expectModel] of [[true, true], [false, false]] as const) {
    const { d, log } = deps({ chat: () => Promise.reject(new HermesError("boom", spent)) });
    assert.equal(await processJob(job(), d), "failed");
    assert.equal("model" in log.failed[0], expectModel, `spent=${spent}`);
  }
});

test("a check-in answered with SKIP is finished silently", async () => {
  const { d, log } = deps({ chat: () => Promise.resolve({ text: " SKIP " }) });
  assert.equal(await processJob(job("checkin"), d), "skipped");
  assert.equal(log.delivered[0].skip, true);
  assert.equal(log.delivered[0].reply, undefined);
});

test("SKIP in a normal chat is just a reply", async () => {
  const { d, log } = deps({ chat: () => Promise.resolve({ text: "SKIP" }) });
  assert.equal(await processJob(job("chat"), d), "delivered");
  assert.equal(log.delivered[0].reply?.text, "SKIP");
});

test("a lost lease or a deleted job drops the result; assistant-deliver has charged it, so the relay doesn't", async () => {
  for (const status of [409, 404]) {
    let calls = 0;
    const { d, log } = deps();
    d.outbox.deliver = () => (calls++, Promise.resolve({ status, body: {} }));
    assert.equal(await processJob(job(), d), "dropped");
    assert.equal(calls, 1, "not retried");
    assert.equal(log.failed.length, 0);
  }
});

test("a delivery refused as invalid isn't retried: the turn is charged through fail and the job goes back", async () => {
  let calls = 0;
  const { d, log } = deps();
  d.outbox.deliver = () => (calls++, Promise.resolve({ status: 400, body: { error: "invalid_input", detail: "body.reply.text must be at most 8000 characters" } }));
  assert.equal(await processJob(job(), d), "failed");
  assert.equal(calls, 1);
  assert.equal(log.failed.length, 1);
  assert.equal(log.failed[0].model, "nvidia/nemotron-3-super");
  assert.deepEqual(log.failed[0].usage, { tokensInput: 900, tokensOutput: 60 });
  assert.match(log.failed[0].error, /^delivery_rejected: 400 .*8000 characters/);
});

test("deliveries that keep failing are charged through fail, which puts the job back", async () => {
  let calls = 0;
  const { d, log } = deps();
  d.outbox.deliver = () => (calls++, Promise.reject(new Error("deliver failed: 500")));
  assert.equal(await processJob(job(), d), "failed");
  assert.equal(calls, 3);
  assert.equal(log.failed.length, 1);
  assert.equal(log.failed[0].model, "nvidia/nemotron-3-super");
  assert.deepEqual(log.failed[0].usage, { tokensInput: 900, tokensOutput: 60 });
  assert.match(log.failed[0].error, /^delivery_failed: Error: deliver failed: 500/);
});

test("a model reply over the limit is cut before it's delivered, never refused", async () => {
  const { d, log } = deps({ chat: () => Promise.resolve({ text: "x".repeat(9000) }) });
  assert.equal(await processJob(job(), d), "delivered");
  assert.equal(log.delivered[0].reply!.text.length, 8000);
});

// ------------------------------------------------------------ lease deadline

test("too little lease left once the sandbox is ready: deferred unspent, sandbox released", async () => {
  const { d, log } = deps();
  const now = d.now().getTime();
  assert.equal(await processJob(job(), d, now + d.turnBudgetMs - 1), "deferred");
  assert.equal(log.chats.length, 0, "the model never ran");
  assert.equal(log.failed.length, 0);
  assert.deepEqual(log.deferred, [{ job_id: 7, lease_token: "lease-7", seconds: LEASE_SHORT_DEFER_SECONDS, reason: "lease_short" }]);
  assert.equal(log.released, 1);
  const enough = deps();
  assert.equal(await processJob(job(), enough.d, now + d.turnBudgetMs), "delivered");
});

test("runOnce: the deadline is the lease from before the claim, so a slow sandbox defers instead of running late", async () => {
  for (const [acquireMs, expected] of [[30_000, "delivered"], [60_000, "deferred"]] as const) {
    let clock = Date.parse("2026-10-10T08:00:00Z");
    const { d } = deps({
      now: () => new Date(clock),
      acquireSandbox: () => {
        clock += acquireMs;
        return Promise.resolve({ endpoint: ENDPOINT, release: () => {} });
      },
    });
    // 180 s lease − 135 s turn budget leaves 45 s to get the sandbox.
    assert.deepEqual(await runOnce(d, 1, 180), [expected], `acquire took ${acquireMs} ms`);
  }
});

test("turnBudget: the turn timeout plus the delivery margin, and a lease too short for it refuses to start", () => {
  assert.equal(turnBudget(180, 120_000), 120_000 + DELIVERY_MARGIN_MS);
  assert.throws(() => turnBudget(150, 120_000), /RELAY_LEASE_SECONDS \(150\) must be at least 165/);
  assert.equal(turnBudget(165, 120_000), 135_000);
});

test("delivery is retried on transient errors (it's idempotent)", async () => {
  let calls = 0;
  const base = deps().d.outbox;
  const { d } = deps({
    outbox: {
      ...base,
      deliver: () => (++calls < 3 ? Promise.reject(new Error("network")) : Promise.resolve({ status: 200, body: {} })),
    },
  });
  assert.equal(await processJob(job(), d), "delivered");
  assert.equal(calls, 3);
});

test("runOnce: a paused queue is logged and runs nothing", async () => {
  const { d, log } = deps({ outbox: { ...deps().d.outbox, claim: () => Promise.resolve({ jobs: [], paused: "daily_limit_reached" }) } });
  assert.deepEqual(await runOnce(d, 2, 180), []);
  assert.ok(log.events.includes("paused"));
});

test("runOnce: one job's reporting failure doesn't sink the batch", async () => {
  const base = deps().d.outbox;
  const { d, log } = deps({
    outbox: {
      ...base,
      claim: () => Promise.resolve({ jobs: [job("chat", "u1"), { ...job("chat", "u2"), id: 8 }] }),
      deliver: (r) => (r.job_id === 7 ? Promise.reject(new Error("down")) : Promise.resolve({ status: 200, body: {} })),
      fail: () => Promise.reject(new Error("down")),
    },
  });
  assert.deepEqual(await runOnce(d, 2, 180), ["failed", "delivered"]);
  assert.ok(log.events.includes("job_error"));
});

// ------------------------------------------------------------ hermes client

function fakeFetch(respond: () => Promise<Response>) {
  const calls: RequestInit[] = [];
  const f = ((_url: string, init: RequestInit) => {
    calls.push(init);
    return respond();
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("hermes: posts OpenAI-style messages with the sandbox key and maps usage", async () => {
  const { f, calls } = fakeFetch(() =>
    Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: " Hi! " } }], usage: { prompt_tokens: 10, completion_tokens: 2 } })))
  );
  const r = await chat(ENDPOINT, [{ role: "user", content: "hey" }], { sessionKey: "u1", timeoutMs: 1000, fetch: f });
  assert.deepEqual(r, { text: "Hi!", usage: { tokensInput: 10, tokensOutput: 2 } });
  const headers = calls[0].headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer sandbox-key");
  assert.equal(headers["x-hermes-session-key"], "u1");
  assert.equal(JSON.parse(calls[0].body as string).stream, false);
});

test("hermes: missing usage is left for the fallback charge", async () => {
  const { f } = fakeFetch(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }))));
  assert.equal((await chat(ENDPOINT, [], { sessionKey: "u1", timeoutMs: 1000, fetch: f })).usage, undefined);
});

test("hermes: errors say whether tokens may have been spent", async () => {
  const cases: Array<[() => Promise<Response>, boolean]> = [
    [() => Promise.resolve(new Response("{}", { status: 429 })), false],
    [() => Promise.resolve(new Response("{}", { status: 502 })), true],
    [() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }))), true],
    [() => Promise.reject(new TypeError("fetch failed")), false],
    [() => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), true],
  ];
  for (const [respond, spent] of cases) {
    const { f } = fakeFetch(respond);
    await assert.rejects(
      () => chat(ENDPOINT, [], { sessionKey: "u1", timeoutMs: 1000, fetch: f }),
      (e: unknown) => e instanceof HermesError && e.mayHaveSpent === spent,
    );
  }
});

test("static sandbox map: parsed, and malformed entries ignored", () => {
  const m = staticSandboxes(JSON.stringify({ u1: ENDPOINT, u2: { baseUrl: 1 } }));
  assert.deepEqual([...m.keys()], ["u1"]);
  assert.equal(staticSandboxes(undefined).size, 0);
});

test("static map: a mapped user gets their endpoint, anyone else waits", async () => {
  const acquire = staticAcquire(staticSandboxes(JSON.stringify({ u1: ENDPOINT })));
  const mine = await acquire(job("chat", "u1"));
  assert.ok("endpoint" in mine);
  assert.deepEqual(mine.endpoint, ENDPOINT);
  assert.deepEqual(await acquire(job("chat", "u2")), { defer: 60, reason: "no_sandbox" });
});
