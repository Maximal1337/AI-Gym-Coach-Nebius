import { test } from "node:test";
import assert from "node:assert/strict";
import { OutboxClient, OutboxError } from "./outbox.js";
import { relaySignature } from "./signing.js";

test("contract: same signature as supabase/functions/_shared/relay-auth.ts", () => {
  assert.equal(
    relaySignature("k".repeat(32), "prod", 1790000000, JSON.stringify({ action: "claim", limit: 2 })),
    "325657353be7e5649e69ebaa369bf56a036b24cc984e1354f143a9be80e66710",
  );
});

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const config = (f: typeof fetch) => ({ functionsUrl: "https://ref.supabase.co/functions/v1", env: "dev" as const, secret: "s".repeat(40), fetch: f, nowSec: () => 1790000000 });

test("claim: signs exactly the body it sends", async () => {
  const { f, calls } = fakeFetch(200, { jobs: [], paused: "daily_limit_reached" });
  const r = await new OutboxClient(config(f)).claim(2, 180);
  assert.deepEqual(r, { jobs: [], paused: "daily_limit_reached" });
  assert.equal(calls[0].url, "https://ref.supabase.co/functions/v1/assistant-outbox");
  assert.equal(calls[0].body, JSON.stringify({ action: "claim", limit: 2, lease_seconds: 180 }));
  assert.equal(calls[0].headers["x-relay-env"], "dev");
  assert.equal(calls[0].headers["x-relay-signature"], relaySignature("s".repeat(40), "dev", 1790000000, calls[0].body));
});

test("claim: a refused request throws with its status", async () => {
  const { f } = fakeFetch(401, { error: "unauthorized" });
  await assert.rejects(() => new OutboxClient(config(f)).claim(2, 180), (e: unknown) => e instanceof OutboxError && e.status === 401);
});

test("deliver: 409, 404 and 400 are answers, not errors; 500 throws", async () => {
  for (const status of [200, 409, 404, 400]) {
    const { f } = fakeFetch(status, {});
    assert.equal((await new OutboxClient(config(f)).deliver({ job_id: 1, lease_token: "t", model: "m", skip: true })).status, status);
  }
  const { f } = fakeFetch(500, {});
  await assert.rejects(() => new OutboxClient(config(f)).deliver({ job_id: 1, lease_token: "t", model: "m", skip: true }));
});

test("fail: long errors are trimmed to what the endpoint accepts", async () => {
  const { f, calls } = fakeFetch(200, { ok: true });
  assert.equal(await new OutboxClient(config(f)).fail({ job_id: 1, lease_token: "t", error: "x".repeat(5000) }), true);
  assert.equal(JSON.parse(calls[0].body).error.length, 2000);
});
