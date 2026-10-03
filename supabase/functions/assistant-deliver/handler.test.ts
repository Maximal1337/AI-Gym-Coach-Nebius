// Tests for assistant-deliver (NH-53). Run: deno test --no-config supabase/functions/
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { DELIVER_SCHEMA, type DeliverDeps, handleDeliver, pushPreview } from "./handler.ts";

const TOKEN = "5f0c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b";
const REPLY = { text: "Solid week: 3 sessions.", sources: [{ title: "USDA", url: "https://fdc.nal.usda.gov/" }] };

function deps(result: Awaited<ReturnType<DeliverDeps["complete"]>>, overrides: Partial<DeliverDeps> = {}) {
  const log = { completes: [] as unknown[][], spend: [] as unknown[][], pushes: [] as unknown[][] };
  const d: DeliverDeps = {
    verify: () => Promise.resolve("prod"),
    complete: (...args) => {
      log.completes.push(args);
      return Promise.resolve(result);
    },
    recordSpend: (...args) => {
      log.spend.push(args);
      return Promise.resolve(1);
    },
    push: (...args) => {
      log.pushes.push(args);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { d, log };
}

const delivered = { data: { status: "delivered", message_id: "m9", user_id: "u1", kind: "chat", coach_name: "Rex" } };
const post = (body: unknown) =>
  new Request("https://example.test/functions/v1/assistant-deliver", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const good = { job_id: 7, lease_token: TOKEN, model: "nemotron-super", usage: { tokensInput: 900, tokensOutput: 80 }, reply: REPLY };

Deno.test("a delivery stores the reply, records the spend and pushes a preview", async () => {
  const { d, log } = deps(delivered);
  const res = await handleDeliver(post(good), d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: "delivered", message_id: "m9" });
  assertEquals(log.completes, [["prod", 7, TOKEN, REPLY, false]]);
  assertEquals(log.spend, [["prod", "nemotron-super", { tokensInput: 900, tokensOutput: 80 }]]);
  assertEquals(log.pushes, [["u1", "Rex", "Solid week: 3 sessions.", { type: "assistant_reply", messageId: "m9" }]]);
});

Deno.test("a retried delivery neither charges nor pushes again", async () => {
  const { d, log } = deps({ data: { status: "already_delivered", message_id: "m9", user_id: "u1" } });
  const res = await handleDeliver(post(good), d);
  assertEquals(await res.json(), { status: "already_delivered", message_id: "m9" });
  assertEquals(log.spend.length, 0);
  assertEquals(log.pushes.length, 0);
});

Deno.test("a skipped check-in is charged but sends no push", async () => {
  const { d, log } = deps({ data: { status: "skipped", user_id: "u1", kind: "checkin" } });
  const res = await handleDeliver(post({ job_id: 7, lease_token: TOKEN, model: "nemotron-super", skip: true }), d);
  assertEquals(await res.json(), { status: "skipped", message_id: null });
  assertEquals(log.completes, [["prod", 7, TOKEN, null, true]]);
  assertEquals(log.spend.length, 1);
  assertEquals(log.pushes.length, 0);
});

Deno.test("missing usage is still charged (the fallback lives in recordSpend)", async () => {
  const { d, log } = deps(delivered);
  const { usage: _drop, ...noUsage } = good;
  await handleDeliver(post(noUsage), d);
  assertEquals(log.spend, [["prod", "nemotron-super", undefined]]);
});

Deno.test("a lost lease is 409 and an unknown job 404 — nothing pushed, the spent tokens still charged", async () => {
  for (const [refusal, status] of [["lease_lost", 409], ["job_not_found", 404]] as const) {
    const { d, log } = deps({ refusal });
    assertEquals((await handleDeliver(post(good), d)).status, status);
    assertEquals(log.pushes.length, 0);
    assertEquals(log.spend, [["prod", "nemotron-super", { tokensInput: 900, tokensOutput: 80 }]]);
  }
});

Deno.test("invalid deliveries never reach the database", async () => {
  const bad = [
    { ...good, reply: undefined },
    { ...good, skip: true },
    { ...good, reply: { text: "" } },
    { ...good, reply: { text: "x", sources: [{ url: "http://insecure.example/page" }] } },
    { ...good, reply: { text: "x", sources: Array.from({ length: 11 }, () => ({ url: "https://a.example/x" })) } },
    { ...good, reply: { text: "x", actions: ["not-a-uuid"] } },
    { ...good, lease_token: "nope" },
    { ...good, model: undefined },
    { ...good, extra: true },
  ];
  for (const body of bad) {
    const { d, log } = deps(delivered);
    assertEquals((await handleDeliver(post(body), d)).status, 400, JSON.stringify(body));
    assertEquals(log.completes.length, 0);
  }
});

Deno.test("an unsigned request is 401", async () => {
  const { d, log } = deps(delivered, { verify: () => Promise.resolve(null) });
  assertEquals((await handleDeliver(post(good), d)).status, 401);
  assertEquals(log.completes.length, 0);
});

Deno.test("an unexpected refusal is an error", async () => {
  const { d } = deps({ refusal: "something_new" });
  await assertRejects(() => handleDeliver(post(good), d));
});

Deno.test("pushPreview flattens whitespace and trims to 140 characters", () => {
  assertEquals(pushPreview("Line one\n\n  line two"), "Line one line two");
  const long = pushPreview("x".repeat(300));
  assertEquals(long.length, 140);
  assertEquals(long.endsWith("…"), true);
});

// The other half of this contract is REPLY_LIMITS in services/relay/src/prompt.ts (and its
// test): the relay cuts every reply to these limits, so change both sides together.
Deno.test("contract: DELIVER_SCHEMA's reply limits are the relay's REPLY_LIMITS", () => {
  const reply = DELIVER_SCHEMA.properties!.reply;
  const sources = reply.properties!.sources;
  const source = sources.items!.properties!;
  assertEquals(
    { text: reply.properties!.text.maxLength, sources: sources.maxItems, urlMin: source.url.minLength, urlMax: source.url.maxLength, title: source.title.maxLength },
    { text: 8000, sources: 10, urlMin: 9, urlMax: 500, title: 200 },
  );
});
