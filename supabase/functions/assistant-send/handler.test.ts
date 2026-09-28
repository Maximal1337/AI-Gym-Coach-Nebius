// Tests for assistant-send (NH-51). Run: deno test --no-config supabase/functions/
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { handleSend, parseSendBody, type SendDeps } from "./handler.ts";

const MESSAGE = { id: "m1", created_at: "2026-10-10T12:00:00Z", doc: { text: "hi" } };

function deps(overrides: Partial<SendDeps> = {}) {
  const enqueued: Array<{ userCap: number; globalCap: number }> = [];
  const d: SendDeps = {
    corsHeaders: () => ({}),
    getUser: () => Promise.resolve({ id: "u1" }),
    isEnabled: () => Promise.resolve(true),
    entitlement: () => Promise.resolve({ ok: true, trialEndsAt: null }),
    allowRate: () => Promise.resolve(true),
    environmentFor: () => Promise.resolve("prod"),
    spendAllowed: () => Promise.resolve(true),
    caps: () => ({ messagesPerUser: 100, messagesGlobal: 1000 }),
    enqueue: (_u, _t, _c, userCap, globalCap) => {
      enqueued.push({ userCap, globalCap });
      return Promise.resolve({ data: { duplicate: false, message: MESSAGE, job_status: "pending" } });
    },
    ...overrides,
  };
  return { d, enqueued };
}

const post = (body: unknown = { text: "hi", client_message_id: "c1" }) =>
  new Request("https://example.test/functions/v1/assistant-send", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer jwt" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

Deno.test("a new message is queued: 202 with the stored message", async () => {
  const { d } = deps();
  const res = await handleSend(post(), d);
  assertEquals(res.status, 202);
  assertEquals(await res.json(), { message: MESSAGE, duplicate: false, status: "pending" });
});

Deno.test("a retried message returns the original with 200", async () => {
  const { d } = deps({ enqueue: () => Promise.resolve({ data: { duplicate: true, message: MESSAGE, job_status: "done" } }) });
  const res = await handleSend(post(), d);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "done");
});

Deno.test("the gate order: user, flag, subscription, rate limit", async () => {
  const cases: Array<[Partial<SendDeps>, number, string]> = [
    [{ getUser: () => Promise.resolve(null) }, 401, "unauthorized"],
    [{ isEnabled: () => Promise.resolve(false) }, 403, "assistant_disabled"],
    [{ entitlement: () => Promise.resolve({ ok: false, trialEndsAt: "2026-10-01T00:00:00Z" }) }, 402, "subscription_required"],
    [{ allowRate: () => Promise.resolve(false) }, 429, "rate_limited"],
  ];
  for (const [override, status, error] of cases) {
    const { d, enqueued } = deps(override);
    const res = await handleSend(post(), d);
    assertEquals(res.status, status, error);
    assertEquals((await res.json()).error, error);
    assertEquals(enqueued.length, 0, `${error}: nothing queued`);
  }
});

Deno.test("at the spend ceiling, new messages are refused with reason spend — but a retry still resolves", async () => {
  const { d, enqueued } = deps({
    spendAllowed: () => Promise.resolve(false),
    enqueue: (_u, _t, _c, userCap, globalCap) => {
      enqueued.push({ userCap, globalCap });
      return Promise.resolve({ refusal: "user_daily_cap" });
    },
  });
  const res = await handleSend(post(), d);
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "daily_limit_reached", reason: "spend" });
  assertEquals(enqueued, [{ userCap: 0, globalCap: 0 }], "caps of 0 let the database answer duplicates first");
});

Deno.test("message caps map to daily_limit_reached with their reason", async () => {
  for (const [refusal, reason] of [["user_daily_cap", "messages"], ["global_daily_cap", "global"]]) {
    const { d } = deps({ enqueue: () => Promise.resolve({ refusal }) });
    const res = await handleSend(post(), d);
    assertEquals(res.status, 429);
    assertEquals(await res.json(), { error: "daily_limit_reached", reason });
  }
});

Deno.test("invalid input is 400 and never queued", async () => {
  for (const body of ["{nope", { text: "", client_message_id: "c" }, { text: "hi" }, { text: "x".repeat(2001), client_message_id: "c" }, [1]]) {
    const { d, enqueued } = deps();
    const res = await handleSend(post(body), d);
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(enqueued.length, 0);
  }
});

Deno.test("an unexpected refusal is an error, not a silent success", async () => {
  const { d } = deps({ enqueue: () => Promise.resolve({ refusal: "something_new" }) });
  await assertRejects(() => handleSend(post(), d));
});

Deno.test("only POST (and OPTIONS) are served", async () => {
  const { d } = deps();
  assertEquals((await handleSend(new Request("https://example.test/", { method: "GET" }), d)).status, 405);
  assertEquals((await handleSend(new Request("https://example.test/", { method: "OPTIONS" }), d)).status, 200);
});

Deno.test("parseSendBody", () => {
  assertEquals(parseSendBody({ text: "hi", client_message_id: "c1" }), { text: "hi", clientMessageId: "c1" });
  assertEquals(parseSendBody({ text: "   ", client_message_id: "c1" }), null);
  assertEquals(parseSendBody({ text: "hi", client_message_id: "" }), null);
  assertEquals(parseSendBody(null), null);
});
