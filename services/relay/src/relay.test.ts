import { test } from "node:test";
import assert from "node:assert/strict";
import { chat, HermesError } from "./hermes.js";
import type { DeliverRequest, FailRequest, JobContext } from "./outbox.js";
import { processJob, type RelayDeps, runOnce } from "./relay.js";
import { staticSandboxes } from "./sandboxes.js";

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
  const log = { delivered: [] as DeliverRequest[], failed: [] as FailRequest[], chats: [] as unknown[][], events: [] as string[] };
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
    },
    sandboxFor: () => Promise.resolve(ENDPOINT),
    chat: (...args) => {
      log.chats.push(args);
      return Promise.resolve({ text: "Rest 2 min. [Guide](https://example.org/rest)", usage: { tokensInput: 900, tokensOutput: 60 } });
    },
    model: "nvidia/nemotron-3-super",
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

test("no ready sandbox: the job goes back to the queue, nothing is charged, nothing is shared", async () => {
  const { d, log } = deps({ sandboxFor: () => Promise.resolve(null) });
  assert.equal(await processJob(job(), d), "failed");
  assert.equal(log.chats.length, 0);
  assert.deepEqual(log.failed, [{ job_id: 7, lease_token: "lease-7", error: "sandbox_unavailable" }]);
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

test("a lost lease drops the result instead of retrying", async () => {
  const { d } = deps({ outbox: { ...deps().d.outbox, deliver: () => Promise.resolve({ status: 409, body: { error: "lease_lost" } }) } });
  assert.equal(await processJob(job(), d), "dropped");
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
  const { d } = deps({
    outbox: {
      ...base,
      claim: () => Promise.resolve({ jobs: [job("chat", "u1"), job("chat", "u2")] }),
      deliver: (r) => (r.job_id === 7 && r.reply ? Promise.reject(new Error("down")) : Promise.resolve({ status: 200, body: {} })),
    },
  });
  const outcomes = await runOnce(d, 2, 180);
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((o) => o === "failed"));
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
