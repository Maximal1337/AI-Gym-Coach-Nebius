#!/usr/bin/env node
// NH-28: the raw Token Factory smoke test. It runs first on the VPS, before
// any runtime wiring, so a model problem can't be mistaken for a harness
// problem. Node 18+ with no dependencies (on Ubuntu 24.04: apt install nodejs).
//
//   node scripts/token-factory-smoke.mjs                 every Nemotron chat model the key can see
//   node scripts/token-factory-smoke.mjs --model <id> …  only these (repeatable)
//
// The key comes from TOKEN_FACTORY_API_KEY, or else from
// ~/.config/notch/tokenfactory.env (plan §0: on the VPS only, never on a
// laptop). It is never printed. The report is Markdown, to paste into NH-28.
//
// Per model, with thinking off (reasoning_effort "none", D-03):
//   1. a full tool round trip: request → tool_calls → tool result → an answer
//      that uses the result
//   2. tool_choice "required" returns a tool call
//   3. response_format json_schema returns JSON that fits the schema
// and, for information, 4. the model's default thinking with a 64-token
// budget — the known failure is thinking that spends the budget and leaves
// `content` empty.
// Exits 1 when no model passes 1–3.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
const TIMEOUT_MS = 90_000;
const MAX_MODELS = 8;

const SYSTEM =
  "You are a strength coach inside a fitness app. Numbers about the user's training come only from your tools. Reply in one or two sentences.";

const HISTORY_TOOL = {
  type: "function",
  function: {
    name: "get_training_history",
    description: "The user's logged sets for one exercise over the last few days.",
    parameters: {
      type: "object",
      properties: {
        exercise: { type: "string", description: "The exercise, e.g. bench press" },
        days: { type: "integer", minimum: 1, maximum: 90 },
      },
      required: ["exercise", "days"],
      additionalProperties: false,
    },
  },
};

// The tool's answer in check 1; the reply must use the weight.
const HISTORY_RESULT = { exercise: "bench press", best_set: { weight_kg: 82.5, reps: 5, date: "2026-09-24" } };

const FACTS_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          category: { type: "string", enum: ["health", "goal", "schedule", "equipment", "preference", "other"] },
        },
        required: ["text", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["facts"],
  additionalProperties: false,
};

/** Models worth testing: Nemotron chat models, or exactly the ones asked for. */
export function pickModels(listed, requested) {
  if (requested.length > 0) return requested;
  return listed
    .filter((id) => /nemotron/i.test(id) && !/embed|rerank|reward|guard|safety/i.test(id))
    .slice(0, MAX_MODELS);
}

/** TOKEN_FACTORY_API_KEY from the environment, else from the env file. */
export function readApiKey(env = process.env, read = (p) => readFileSync(p, "utf8"), home = homedir()) {
  if (env.TOKEN_FACTORY_API_KEY?.trim()) return env.TOKEN_FACTORY_API_KEY.trim();
  const file = join(home, ".config", "notch", "tokenfactory.env");
  let text;
  try {
    text = read(file);
  } catch {
    throw new Error(`no TOKEN_FACTORY_API_KEY in the environment and no ${file}`);
  }
  const line = text.split(/\r?\n/).find((l) => l.startsWith("TOKEN_FACTORY_API_KEY="));
  const key = line?.slice("TOKEN_FACTORY_API_KEY=".length).trim();
  if (!key) throw new Error(`${file} has no TOKEN_FACTORY_API_KEY=`);
  return key;
}

function client({ baseUrl, apiKey, fetch, now }) {
  async function call(method, path, body) {
    const started = now();
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
      break;
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
    if (json === undefined) throw new Error(`not JSON: ${text.slice(0, 200)}`);
    return { json, ms: now() - started };
  }
  return {
    models: async () => (await call("GET", "/models")).json,
    chat: (body) => call("POST", "/chat/completions", body),
  };
}

/** What one reply looked like, for the report. */
function observe({ json, ms }) {
  const choice = json.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const reasoning = message.reasoning_content ?? message.reasoning ?? "";
  return {
    ms,
    message,
    finish: choice.finish_reason ?? null,
    content: typeof message.content === "string" ? message.content : "",
    reasoning: typeof reasoning === "string" && reasoning.trim() !== "",
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    tokensIn: json.usage?.prompt_tokens ?? null,
    tokensOut: json.usage?.completion_tokens ?? null,
  };
}

async function check(fn) {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), calls: [] };
  }
}

function parseArgs(call) {
  try {
    return JSON.parse(call.function?.arguments ?? "");
  } catch {
    return undefined;
  }
}

export async function runChecks({ baseUrl, apiKey, model, fetch = globalThis.fetch, now = () => Date.now() }) {
  const api = client({ baseUrl, apiKey, fetch, now });
  const user = (content) => [{ role: "system", content: SYSTEM }, { role: "user", content }];

  const roundTrip = await check(async () => {
    const messages = user("What was my best bench press set in the last 7 days?");
    const first = observe(await api.chat({ model, messages, tools: [HISTORY_TOOL], tool_choice: "auto", reasoning_effort: "none", max_tokens: 400 }));
    const call = first.toolCalls[0];
    if (!call) return { ok: false, error: `no tool call (finish ${first.finish}, content "${first.content.slice(0, 80)}")`, calls: [first] };
    const args = parseArgs(call);
    if (call.function?.name !== "get_training_history" || typeof args?.exercise !== "string") {
      return { ok: false, error: `bad tool call: ${call.function?.name} ${call.function?.arguments}`, calls: [first] };
    }
    const second = observe(
      await api.chat({
        model,
        messages: [
          ...messages,
          { role: "assistant", content: first.message.content ?? null, tool_calls: first.toolCalls },
          { role: "tool", tool_call_id: call.id, content: JSON.stringify(HISTORY_RESULT) },
        ],
        tools: [HISTORY_TOOL],
        reasoning_effort: "none",
        max_tokens: 400,
      }),
    );
    const calls = [first, second];
    if (second.content.trim() === "") return { ok: false, error: `empty answer after the tool result (finish ${second.finish})`, calls };
    if (!/82[.,]5/.test(second.content)) return { ok: false, error: `the answer doesn't use the tool result: "${second.content.slice(0, 120)}"`, calls };
    return { ok: true, calls };
  });

  const required = await check(async () => {
    const reply = observe(await api.chat({ model, messages: user("Hi!"), tools: [HISTORY_TOOL], tool_choice: "required", reasoning_effort: "none", max_tokens: 200 }));
    if (reply.toolCalls.length === 0) return { ok: false, error: `no tool call (finish ${reply.finish})`, calls: [reply] };
    return { ok: true, calls: [reply] };
  });

  const schema = await check(async () => {
    const reply = observe(
      await api.chat({
        model,
        messages: [
          { role: "system", content: "Extract lasting facts about the user as JSON. Short neutral statements." },
          { role: "user", content: "I train Mondays and Thursdays, and my left knee hurts on deep squats." },
        ],
        response_format: { type: "json_schema", json_schema: { name: "facts", strict: true, schema: FACTS_SCHEMA } },
        reasoning_effort: "none",
        max_tokens: 400,
      }),
    );
    let parsed;
    try {
      parsed = JSON.parse(reply.content);
    } catch {
      return { ok: false, error: `not JSON: "${reply.content.slice(0, 120)}"`, calls: [reply] };
    }
    const categories = FACTS_SCHEMA.properties.facts.items.properties.category.enum;
    const fits =
      Array.isArray(parsed?.facts) &&
      parsed.facts.length > 0 &&
      parsed.facts.every((f) => typeof f?.text === "string" && categories.includes(f?.category));
    if (!fits) return { ok: false, error: `doesn't fit the schema: ${reply.content.slice(0, 120)}`, calls: [reply] };
    return { ok: true, calls: [reply] };
  });

  // Informational: the model's own default, no reasoning_effort, a small budget.
  const thinking = await check(async () => {
    const reply = observe(await api.chat({ model, messages: [{ role: "user", content: "In one word: is brisk walking cardio?" }], max_tokens: 64 }));
    return { ok: reply.content.trim() !== "", calls: [reply], emptyWithReasoning: reply.content.trim() === "" && reply.reasoning };
  });

  const offCalls = [...roundTrip.calls, ...required.calls, ...schema.calls];
  return {
    model,
    roundTrip,
    required,
    schema,
    thinking,
    interactiveReady: roundTrip.ok && required.ok && schema.ok,
    // Thinking came back although it was switched off: reasoning_effort may not reach the model.
    reasoningWhileOff: offCalls.some((c) => c.reasoning),
  };
}

function cell(result) {
  if (!result.ok) return `❌ ${result.error ? result.error.replace(/\|/g, "\\|") : "no content"}`;
  const ms = result.calls.reduce((a, c) => a + c.ms, 0);
  const tin = result.calls.reduce((a, c) => a + (c.tokensIn ?? 0), 0);
  const tout = result.calls.reduce((a, c) => a + (c.tokensOut ?? 0), 0);
  return `✅ ${(ms / 1000).toFixed(1)} s, ${tin}→${tout} tok`;
}

function thinkingCell(result) {
  if (result.error) return `❌ ${result.error.replace(/\|/g, "\\|")}`;
  const c = result.calls[0];
  if (result.emptyWithReasoning) return `⚠️ content empty, thinking used the budget (finish ${c.finish})`;
  if (!result.ok) return `⚠️ content empty (finish ${c.finish})`;
  return `✅ answered, ${c.tokensOut ?? "?"} tok${c.reasoning ? ", with reasoning" : ""}`;
}

export function renderReport({ date, baseUrl, listed, results }) {
  const lines = [
    `### Token Factory smoke test — ${date}`,
    "",
    `Base URL \`${baseUrl}\`. The key lists ${listed.length} model(s); Nemotron: ${
      listed.filter((id) => /nemotron/i.test(id)).map((id) => `\`${id}\``).join(", ") || "none"
    }.`,
    "",
    "| Model | 1. Tool round trip | 2. `tool_choice: required` | 3. JSON schema | 4. Default thinking, 64 tokens |",
    "|---|---|---|---|---|",
    ...results.map((r) => `| \`${r.model}\` | ${cell(r.roundTrip)} | ${cell(r.required)} | ${cell(r.schema)} | ${thinkingCell(r.thinking)} |`),
    "",
    "Checks 1–3 run with `reasoning_effort: \"none\"`; times and tokens are summed over each check's calls.",
  ];
  const warnings = results.filter((r) => r.reasoningWhileOff).map((r) => `- \`${r.model}\`: reasoning came back although \`reasoning_effort\` was \"none\".`);
  if (warnings.length) lines.push("", ...warnings);
  const ready = results.filter((r) => r.interactiveReady).map((r) => `\`${r.model}\``);
  lines.push(
    "",
    ready.length
      ? `**Ready for interactive turns (1–3 pass):** ${ready.join(", ")}.`
      : "**No model passed 1–3.** Next (NH-28): a different Nemotron variant or tool calling in our own loop, and a question in the Nebius Discord.",
  );
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2), { env = process.env, fetch = globalThis.fetch, log = console.log } = {}) {
  const requested = [];
  let baseUrl = env.TOKEN_FACTORY_BASE_URL || DEFAULT_BASE_URL;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model" && argv[i + 1]) requested.push(argv[++i]);
    else if (argv[i] === "--base-url" && argv[i + 1]) baseUrl = argv[++i].replace(/\/+$/, "");
    else throw new Error(`unknown argument ${argv[i]} — usage: token-factory-smoke.mjs [--model <id>]… [--base-url <url>]`);
  }
  const apiKey = readApiKey(env);
  const api = client({ baseUrl, apiKey, fetch, now: () => Date.now() });
  const listed = ((await api.models()).data ?? []).map((m) => m.id).filter((id) => typeof id === "string").sort();
  const models = pickModels(listed, requested);
  if (models.length === 0) throw new Error(`no Nemotron chat model among the ${listed.length} the key lists; pass --model <id>`);
  const results = [];
  for (const model of models) {
    process.stderr.write(`testing ${model}…\n`);
    results.push(await runChecks({ baseUrl, apiKey, model, fetch }));
  }
  log(renderReport({ date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", baseUrl, listed, results }));
  return results.some((r) => r.interactiveReady) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`error: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    },
  );
}
