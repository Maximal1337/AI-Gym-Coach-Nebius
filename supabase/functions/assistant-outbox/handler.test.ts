// Tests for assistant-outbox (NH-52). Run: deno test --no-config supabase/functions/
import { assertEquals } from "jsr:@std/assert@1";
import { relayHeaders, verifyRelayRequest } from "../_shared/relay-auth.ts";
import { DEFAULT_CLAIM_LIMIT, DEFAULT_LEASE_SECONDS, handleOutbox, type OutboxDeps } from "./handler.ts";

const TOKEN = "5f0c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b";
const USER = "3f1c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b";

function deps(overrides: Partial<OutboxDeps> = {}) {
  const log = {
    claims: [] as unknown[][],
    fails: [] as unknown[][],
    spend: [] as unknown[][],
    defers: [] as unknown[][],
    records: [] as unknown[][],
  };
  const d: OutboxDeps = {
    verify: () => Promise.resolve("prod"),
    spendAllowed: () => Promise.resolve(true),
    claim: (...args) => {
      log.claims.push(args);
      return Promise.resolve([{ id: 7, lease_token: TOKEN, leased_until: "2026-10-10T12:03:00Z", status: "leased" }]);
    },
    context: (jobId) => Promise.resolve({ job: { id: jobId, kind: "chat" }, message: { text: "hi" }, history: [], facts: [] }),
    fail: (...args) => {
      log.fails.push(args);
      return Promise.resolve(true);
    },
    recordSpend: (...args) => {
      log.spend.push(args);
      return Promise.resolve(1);
    },
    defer: (...args) => {
      log.defers.push(args);
      return Promise.resolve(true);
    },
    recordAgent: (...args) => {
      log.records.push(args);
      return Promise.resolve("recorded");
    },
    listAgents: (env) => Promise.resolve([{ user_id: USER, sandbox_name: `notch-${env}-abc` }]),
    ...overrides,
  };
  return { d, log };
}

const post = (body: unknown) =>
  new Request("https://example.test/functions/v1/assistant-outbox", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

Deno.test("claim: leased jobs come back with their context and lease", async () => {
  const { d, log } = deps();
  const res = await handleOutbox(post({ action: "claim" }), d);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.jobs, [{
    id: 7,
    lease_token: TOKEN,
    leased_until: "2026-10-10T12:03:00Z",
    job: { id: 7, kind: "chat" },
    message: { text: "hi" },
    history: [],
    facts: [],
  }]);
  assertEquals(log.claims, [["prod", DEFAULT_CLAIM_LIMIT, DEFAULT_LEASE_SECONDS]]);
});

Deno.test("claim: at the spend ceiling nothing is leased", async () => {
  const { d, log } = deps({ spendAllowed: () => Promise.resolve(false) });
  const res = await handleOutbox(post({ action: "claim", limit: 5 }), d);
  assertEquals(await res.json(), { jobs: [], paused: "daily_limit_reached" });
  assertEquals(log.claims.length, 0);
});

Deno.test("claim: limit and lease are bounded", async () => {
  for (const body of [{ action: "claim", limit: 11 }, { action: "claim", lease_seconds: 5 }, { action: "claim", extra: 1 }]) {
    const { d, log } = deps();
    assertEquals((await handleOutbox(post(body), d)).status, 400, JSON.stringify(body));
    assertEquals(log.claims.length, 0);
  }
});

Deno.test("fail: records the tokens spent, then returns the job to the queue", async () => {
  const { d, log } = deps();
  const res = await handleOutbox(post({
    action: "fail",
    job_id: 7,
    lease_token: TOKEN,
    error: "hermes timeout",
    model: "nemotron-super",
    usage: { tokensInput: 100, tokensOutput: 5 },
  }), d);
  assertEquals(await res.json(), { ok: true });
  assertEquals(log.spend, [["prod", "nemotron-super", { tokensInput: 100, tokensOutput: 5 }]]);
  assertEquals(log.fails, [[7, TOKEN, "hermes timeout"]]);
});

Deno.test("fail: without a model, nothing is charged (the call never reached the model)", async () => {
  const { d, log } = deps();
  await handleOutbox(post({ action: "fail", job_id: 7, lease_token: TOKEN, error: "sandbox not ready" }), d);
  assertEquals(log.spend.length, 0);
  assertEquals(log.fails.length, 1);
});

Deno.test("defer: hands the job back with its delay and reason, nothing charged", async () => {
  const { d, log } = deps();
  const res = await handleOutbox(post({ action: "defer", job_id: 7, lease_token: TOKEN, seconds: 20, reason: "capacity" }), d);
  assertEquals(await res.json(), { ok: true });
  assertEquals(log.defers, [["prod", 7, TOKEN, 20, "capacity"]]);
  assertEquals(log.spend.length, 0);
  const noReason = deps();
  await handleOutbox(post({ action: "defer", job_id: 7, lease_token: TOKEN, seconds: 5 }), noReason.d);
  assertEquals(noReason.log.defers, [["prod", 7, TOKEN, 5, null]]);
});

Deno.test("defer: the delay is bounded and the lease must be a UUID", async () => {
  for (const body of [
    { action: "defer", job_id: 7, lease_token: TOKEN, seconds: 0 },
    { action: "defer", job_id: 7, lease_token: TOKEN, seconds: 3601 },
    { action: "defer", job_id: 7, lease_token: "nope", seconds: 10 },
    { action: "defer", job_id: 7, lease_token: TOKEN },
  ]) {
    const { d, log } = deps();
    assertEquals((await handleOutbox(post(body), d)).status, 400);
    assertEquals(log.defers.length, 0);
  }
});

Deno.test("record_agent: records for the signing environment only", async () => {
  const { d, log } = deps();
  const hash = "c".repeat(64);
  const res = await handleOutbox(post({ action: "record_agent", user_id: USER, sandbox_name: "notch-prod-abc", tool_token_hash: hash }), d);
  assertEquals(await res.json(), { status: "recorded" });
  assertEquals(log.records, [["prod", USER, "notch-prod-abc", hash]]);

  for (const body of [
    { action: "record_agent", user_id: USER, sandbox_name: "notch-dev-abc", tool_token_hash: hash },
    { action: "record_agent", user_id: USER, sandbox_name: "Notch-prod-abc", tool_token_hash: hash },
    { action: "record_agent", user_id: USER, sandbox_name: "notch-prod-abc", tool_token_hash: "C".repeat(64) },
    { action: "record_agent", user_id: "someone", sandbox_name: "notch-prod-abc", tool_token_hash: hash },
  ]) {
    const bad = deps();
    assertEquals((await handleOutbox(post(body), bad.d)).status, 400);
    assertEquals(bad.log.records.length, 0);
  }
});

Deno.test("list_agents: the signing environment's sandboxes", async () => {
  const { d } = deps({ verify: () => Promise.resolve("dev") });
  const res = await handleOutbox(post({ action: "list_agents" }), d);
  assertEquals(await res.json(), { agents: [{ user_id: USER, sandbox_name: "notch-dev-abc" }] });
  assertEquals((await handleOutbox(post({ action: "list_agents", env: "prod" }), d)).status, 400);
});

Deno.test("an unsigned request, a bad body or an unknown action is refused", async () => {
  const { d } = deps({ verify: () => Promise.resolve(null) });
  assertEquals((await handleOutbox(post({ action: "claim" }), d)).status, 401);
  const ok = deps().d;
  assertEquals((await handleOutbox(post("{nope"), ok)).status, 400);
  assertEquals((await handleOutbox(post({ action: "drop" }), ok)).status, 400);
  assertEquals((await handleOutbox(post({ action: "fail", job_id: 7 }), ok)).status, 400);
  assertEquals((await handleOutbox(new Request("https://example.test/", { method: "GET" }), ok)).status, 405);
});

Deno.test("with real signing: the handler verifies the exact bytes it received", async () => {
  const secret = "s".repeat(40);
  const now = 1_790_000_000;
  const body = JSON.stringify({ action: "claim", limit: 1 });
  const { d } = deps({ verify: (req, text) => verifyRelayRequest(req.headers, text, { dev: secret }, now) });
  const signed = new Request("https://example.test/", { method: "POST", headers: await relayHeaders(secret, "dev", body, now), body });
  assertEquals((await handleOutbox(signed, d)).status, 200);
  const tampered = new Request("https://example.test/", {
    method: "POST",
    headers: await relayHeaders(secret, "dev", body, now),
    body: body.replace("1", "9"),
  });
  assertEquals((await handleOutbox(tampered, d)).status, 401);
});
