// The NH-28 smoke test's own logic, against a fake Token Factory: what it
// sends, how it judges replies, and the report. The real run is on the VPS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, pickModels, readApiKey, renderReport, runChecks } from "./token-factory-smoke.mjs";

const KEY = "tf-secret-key-for-tests";

function reply(message, { finish = "stop", usage = { prompt_tokens: 100, completion_tokens: 20 } } = {}) {
  return { choices: [{ message: { role: "assistant", ...message }, finish_reason: finish }], usage };
}

// A model that does everything right.
function goodModel(body) {
  const last = body.messages.at(-1);
  if (last.role === "tool") return reply({ content: "Your best set was 82.5 kg for 5 reps on Sep 24." });
  if (body.tools) {
    return reply(
      {
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "get_training_history", arguments: '{"exercise":"bench press","days":7}' } }],
      },
      { finish: "tool_calls" },
    );
  }
  if (body.response_format) return reply({ content: '{"facts":[{"text":"Trains Mondays and Thursdays","category":"schedule"}]}' });
  return reply({ content: "Yes" });
}

// A reasoning model that never calls tools and thinks through small budgets.
function thinkingModel(body) {
  if (!body.reasoning_effort) return reply({ content: "", reasoning_content: "Let me think about walking…" }, { finish: "length" });
  if (body.response_format) return reply({ content: "Sure! Here are the facts: trains twice a week." });
  return reply({ content: "I'd need to check your log.", reasoning_content: "The user wants…" });
}

function fakeFetch(models, { listed = Object.keys(models), status } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, headers: init.headers, body });
    if (status) return new Response(JSON.stringify({ error: { message: "bad request: unknown field" } }), { status });
    if (url.endsWith("/models")) return new Response(JSON.stringify({ data: listed.map((id) => ({ id })) }));
    return new Response(JSON.stringify(models[body.model](body)));
  };
  return { fetch, requests };
}

const base = { baseUrl: "https://tf.test/v1", apiKey: KEY, now: () => 0 };

test("pickModels: Nemotron chat models only, capped, unless models are named", () => {
  const listed = [
    "meta-llama/Llama-3.3-70B-Instruct",
    "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B",
    "nvidia/llama-nemotron-embed-1b",
    "nvidia/Nemotron-Safety-Guard-8B",
    "nvidia/Nemotron-3-Ultra",
  ];
  assert.deepEqual(pickModels(listed, []), ["nvidia/NVIDIA-Nemotron-3-Super-120B-A12B", "nvidia/Nemotron-3-Ultra"]);
  assert.deepEqual(pickModels(listed, ["x/y"]), ["x/y"]);
  assert.equal(pickModels(Array.from({ length: 12 }, (_, i) => `nemotron-${i}`), []).length, 8);
});

test("readApiKey: the environment first, then the env file (CRLF too), never an empty key", () => {
  assert.equal(readApiKey({ TOKEN_FACTORY_API_KEY: ` ${KEY} ` }), KEY);
  const read = (path) => {
    assert.match(path.replace(/\\/g, "/"), /\/home\/claude\/\.config\/notch\/tokenfactory\.env$/);
    return `# comment\r\nTOKEN_FACTORY_API_KEY=${KEY}\r\n`;
  };
  assert.equal(readApiKey({}, read, "/home/claude"), KEY);
  assert.throws(() => readApiKey({}, () => "TOKEN_FACTORY_API_KEY=\n", "/h"), /has no TOKEN_FACTORY_API_KEY/);
  assert.throws(() => readApiKey({}, () => { throw new Error("ENOENT"); }, "/h"), /no TOKEN_FACTORY_API_KEY in the environment/);
});

test("a good model passes 1–3, and the requests are the ones NH-28 asks for", async () => {
  const { fetch, requests } = fakeFetch({ good: goodModel });
  const r = await runChecks({ ...base, model: "good", fetch });
  assert.equal(r.interactiveReady, true);
  assert.equal(r.reasoningWhileOff, false);
  assert.equal(r.thinking.ok, true);

  assert.equal(requests.length, 5);
  for (const q of requests) assert.equal(q.headers.authorization, `Bearer ${KEY}`);
  // 1–3 with thinking off; 4 with the model's default and a 64-token budget.
  assert.deepEqual(requests.map((q) => q.body.reasoning_effort), ["none", "none", "none", "none", undefined]);
  assert.equal(requests[4].body.max_tokens, 64);
  // The round trip hands the tool call back with its result.
  const [assistant, tool] = requests[1].body.messages.slice(-2);
  assert.equal(assistant.tool_calls[0].id, "call_1");
  assert.equal(tool.role, "tool");
  assert.equal(tool.tool_call_id, "call_1");
  assert.match(tool.content, /82\.5/);
  assert.equal(requests[2].body.tool_choice, "required");
  assert.equal(requests[3].body.response_format.type, "json_schema");
  assert.equal(requests[3].body.response_format.json_schema.strict, true);
});

test("a model that won't call tools, breaks the schema and thinks through its budget fails, with reasons", async () => {
  const { fetch } = fakeFetch({ thinker: thinkingModel });
  const r = await runChecks({ ...base, model: "thinker", fetch });
  assert.equal(r.interactiveReady, false);
  assert.match(r.roundTrip.error, /no tool call/);
  assert.match(r.required.error, /no tool call/);
  assert.match(r.schema.error, /not JSON/);
  assert.equal(r.thinking.emptyWithReasoning, true);
  assert.equal(r.reasoningWhileOff, true);
});

test("an answer that ignores the tool result fails the round trip", async () => {
  const model = (body) => (body.messages.at(-1).role === "tool" ? reply({ content: "You lifted well this week!" }) : goodModel(body));
  const { fetch } = fakeFetch({ m: model });
  const r = await runChecks({ ...base, model: "m", fetch });
  assert.match(r.roundTrip.error, /doesn't use the tool result/);
  assert.equal(r.interactiveReady, false);
});

test("an HTTP error is reported per check, not thrown", async () => {
  const { fetch } = fakeFetch({ m: goodModel }, { status: 400 });
  const r = await runChecks({ ...base, model: "m", fetch });
  assert.match(r.roundTrip.error, /^HTTP 400: .*unknown field/);
  assert.equal(r.interactiveReady, false);
});

test("the report: one row per model, the verdict, warnings, pipes escaped", async () => {
  const good = await runChecks({ ...base, model: "good", fetch: fakeFetch({ good: goodModel }).fetch });
  const bad = await runChecks({ ...base, model: "thinker", fetch: fakeFetch({ thinker: thinkingModel }).fetch });
  bad.schema.error = "a | b";
  const report = renderReport({ date: "2026-10-01 09:00 UTC", baseUrl: "https://tf.test/v1", listed: ["good", "nvidia/nemotron-x"], results: [good, bad] });
  assert.match(report, /^\| `good` \| ✅ .* \| ✅ .* \| ✅ .* \| ✅ answered/m);
  assert.match(report, /^\| `thinker` \| ❌ no tool call/m);
  assert.match(report, /⚠️ content empty, thinking used the budget/);
  assert.match(report, /a \\\| b/);
  assert.match(report, /`thinker`: reasoning came back although/);
  assert.match(report, /\*\*Ready for interactive turns \(1–3 pass\):\*\* `good`\./);
  assert.match(report, /Nemotron: `nvidia\/nemotron-x`/);

  const none = renderReport({ date: "d", baseUrl: "u", listed: [], results: [bad] });
  assert.match(none, /\*\*No model passed 1–3\.\*\*/);
});

test("main: lists, tests the Nemotron models, exits by the verdict, never prints the key", async () => {
  const listed = ["other/model", "nvidia/nemotron-good", "nvidia/nemotron-thinker"];
  const models = { "nvidia/nemotron-good": goodModel, "nvidia/nemotron-thinker": thinkingModel };
  let out = "";
  const code = await main([], { env: { TOKEN_FACTORY_API_KEY: KEY }, fetch: fakeFetch(models, { listed }).fetch, log: (s) => (out += s) });
  assert.equal(code, 0);
  assert.match(out, /`nvidia\/nemotron-good`/);
  assert.match(out, /`nvidia\/nemotron-thinker`/);
  assert.doesNotMatch(out, /other\/model` \|/);
  assert.ok(!out.includes(KEY));

  const failing = await main(["--model", "nvidia/nemotron-thinker"], { env: { TOKEN_FACTORY_API_KEY: KEY }, fetch: fakeFetch(models, { listed }).fetch, log: () => {} });
  assert.equal(failing, 1);
  await assert.rejects(main(["--bogus"], { env: { TOKEN_FACTORY_API_KEY: KEY }, fetch: fakeFetch(models).fetch, log: () => {} }), /unknown argument/);
});
