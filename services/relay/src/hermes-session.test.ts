import { test } from "node:test";
import assert from "node:assert/strict";
import { isSessionId, readTurn, SESSION_READ_TIMEOUT_MS } from "./hermes-session.js";

const ENDPOINT = { baseUrl: "https://default--notch-dev-x.openshell.localhost:8080", apiKey: "sandbox-key" };

/** A session's messages as Hermes' API serves them, newest first, the previous turn included. */
const SESSION = [
  { role: "assistant", content: "Here's what I found.", timestamp: 40 },
  { role: "tool", tool_name: "web_search", content: "{...this turn...}", timestamp: 30 },
  { role: "assistant", content: "", tool_calls: [{ function: { name: "web_search" } }], timestamp: 20 },
  { role: "user", content: "And for quinoa?", timestamp: 10 },
  { role: "assistant", content: "Rice has…", timestamp: 9 },
  { role: "tool", tool_name: "web_search", content: "{...the turn before...}", timestamp: 8 },
  { role: "user", content: "Protein in rice?", timestamp: 5 },
];

function serve(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("readTurn: only this turn's messages — after its own user message — oldest first, read with the sandbox's key", async () => {
  // Out of order on purpose: the timestamps decide.
  const { f, calls } = serve(200, { data: [SESSION[3], SESSION[0], SESSION[5], SESSION[2], SESSION[1], SESSION[4], SESSION[6]] });
  const turn = await readTurn(ENDPOINT, "api-0f3a9c", { fetch: f });
  assert.deepEqual(turn.map((m) => m.timestamp), [20, 30, 40]);
  assert.ok(!turn.some((m) => String(m.content).includes("the turn before")));
  assert.equal(calls[0].url, `${ENDPOINT.baseUrl}/api/sessions/api-0f3a9c/messages?order=latest&limit=60`);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["x-hermes-api-key"], "sandbox-key");
  assert.ok(calls[0].init.signal, "bounded by a timeout");
});

test("readTurn: a page with no user message on it is all one turn", async () => {
  const { f } = serve(200, { data: SESSION.slice(0, 3) });
  assert.deepEqual((await readTurn(ENDPOINT, "api-1", { fetch: f })).map((m) => m.timestamp), [20, 30, 40]);
});

test("readTurn: a refused read, a body without messages, or an id that isn't Hermes' throws — for the caller to ignore", async () => {
  await assert.rejects(readTurn(ENDPOINT, "api-1", { fetch: serve(404, { error: { code: "session_not_found" } }).f }), /404/);
  await assert.rejects(readTurn(ENDPOINT, "api-1", { fetch: serve(200, { object: "list" }).f }), /no messages/);
  for (const id of ["../etc", "a b", "x".repeat(129), ""]) {
    assert.equal(isSessionId(id), false, id);
    await assert.rejects(readTurn(ENDPOINT, id, { fetch: serve(200, { data: [] }).f }), /not a Hermes session id/);
  }
});

test("readTurn: a session that doesn't answer is given up after the timeout (about 3 s; shortened here)", async () => {
  assert.equal(SESSION_READ_TIMEOUT_MS, 3_000);
  const hung = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
  const started = Date.now();
  await assert.rejects(readTurn(ENDPOINT, "api-1", { fetch: hung, timeoutMs: 50 }), (e: unknown) => e instanceof Error && e.name === "TimeoutError");
  assert.ok(Date.now() - started < 1_000);
});
