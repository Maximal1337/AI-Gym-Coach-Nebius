// Tests for the Token Factory client (NH-63). Run: deno test --no-config supabase/functions/
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { tokenFactoryChat, TokenFactoryError } from "./token-factory.ts";

function scripted(responses: Array<() => Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const f = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses[Math.min(i++, responses.length - 1)]();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (content: unknown, extra: Record<string, unknown> = {}) => () =>
  Promise.resolve(new Response(JSON.stringify({ model: "nvidia/nemotron-ultra", choices: [{ message: { content } }], usage: { prompt_tokens: 1200, completion_tokens: 300 }, ...extra })));
const status = (code: number) => () => Promise.resolve(new Response(JSON.stringify({ error: "x" }), { status: code }));
const slept: number[] = [];
const base = { apiKey: "key", model: "nvidia/nemotron-ultra", messages: [{ role: "user" as const, content: "hi" }], sleep: (ms: number) => (slept.push(ms), Promise.resolve()) };

Deno.test("sends an OpenAI-style request with the schema and maps usage", async () => {
  const { f, calls } = scripted([ok('{"operations":[]}')]);
  const r = await tokenFactoryChat({ ...base, fetch: f, jsonSchema: { name: "ops", schema: { type: "object" } }, maxTokens: 8000 });
  assertEquals(r, { content: '{"operations":[]}', usage: { tokensInput: 1200, tokensOutput: 300 }, model: "nvidia/nemotron-ultra" });
  assertEquals(calls[0].url, "https://api.tokenfactory.nebius.com/v1/chat/completions");
  const body = JSON.parse(calls[0].init.body as string);
  assertEquals(body.response_format, { type: "json_schema", json_schema: { name: "ops", schema: { type: "object" } } });
  assertEquals(body.max_tokens, 8000);
  assertEquals("reasoning_effort" in body, false);
  assertEquals((calls[0].init.headers as Record<string, string>).authorization, "Bearer key");
});

Deno.test("reasoning effort is passed only when set", async () => {
  const { f, calls } = scripted([ok("hi")]);
  await tokenFactoryChat({ ...base, fetch: f, reasoningEffort: "none" });
  assertEquals(JSON.parse(calls[0].init.body as string).reasoning_effort, "none");
});

Deno.test("429 and 5xx are retried with backoff", async () => {
  slept.length = 0;
  const { f, calls } = scripted([status(429), status(503), ok("done")]);
  assertEquals((await tokenFactoryChat({ ...base, fetch: f })).content, "done");
  assertEquals(calls.length, 3);
  assertEquals(slept, [1000, 3000]);
});

Deno.test("retries run out: the last error is thrown", async () => {
  const { f, calls } = scripted([status(500)]);
  const e = await assertRejects(() => tokenFactoryChat({ ...base, fetch: f }), TokenFactoryError);
  assertEquals([e.status, calls.length], [500, 3]);
});

Deno.test("other 4xx fail at once, marked as not spent", async () => {
  const { f, calls } = scripted([status(401)]);
  const e = await assertRejects(() => tokenFactoryChat({ ...base, fetch: f }), TokenFactoryError);
  assertEquals([e.status, e.spent, calls.length], [401, false, 1]);
});

Deno.test("reasoning with empty content fails loudly, is not retried, and carries the usage", async () => {
  const { f, calls } = scripted([() =>
    Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "", reasoning_content: "thinking…" } }], usage: { prompt_tokens: 10, completion_tokens: 8000 } })))
  ]);
  const e = await assertRejects(() => tokenFactoryChat({ ...base, fetch: f }), TokenFactoryError);
  assertEquals(e.message, "empty content: reasoning used the whole budget");
  assertEquals((e as unknown as { usage: unknown }).usage, { tokensInput: 10, tokensOutput: 8000 });
  assertEquals(calls.length, 1);
});

Deno.test("network errors are retried", async () => {
  const { f, calls } = scripted([() => Promise.reject(new TypeError("fetch failed")), ok("back")]);
  assertEquals((await tokenFactoryChat({ ...base, fetch: f })).content, "back");
  assertEquals(calls.length, 2);
});
