/**
 * Memory evaluation against Nemotron on Token Factory (NH-65).
 *
 *   TOKEN_FACTORY_API_KEY=... MEMORY_MODEL=... \
 *     deno run --no-config --allow-env --allow-net supabase/eval/memory/run.ts
 *
 * For every scenario in golden.json it runs the same extraction the nightly
 * job does (prompt, validation, scoring plan), scores the resulting memory,
 * then runs a second pass over the same messages with the updated memory: an
 * idempotent job adds and removes nothing the second time. Prints a markdown
 * table to paste into the plan. Each scenario is one model call per pass —
 * about 24 calls in all.
 */

import golden from "./golden.json" with { type: "json" };
import {
  buildMemoryWrite,
  OPERATIONS_SCHEMA,
  parseOperations,
  systemPrompt,
  userPrompt,
} from "../../functions/_shared/memory-extraction.ts";
import { memoryAfter, type Scenario, scenarioInput, scoreScenario, totals } from "../../functions/_shared/memory-eval.ts";
import { tokenFactoryChat } from "../../functions/_shared/token-factory.ts";
import type { StoredFact } from "../../functions/_shared/memory-scoring.ts";

const apiKey = Deno.env.get("TOKEN_FACTORY_API_KEY");
const model = Deno.env.get("MEMORY_MODEL");
if (!apiKey || !model) {
  console.error("Set TOKEN_FACTORY_API_KEY and MEMORY_MODEL.");
  Deno.exit(2);
}

const now = new Date();
let tokensIn = 0;
let tokensOut = 0;

async function pass(s: Scenario, stored: StoredFact[]) {
  const { messages } = scenarioInput(s, now);
  const language = s.language ?? "en";
  const reply = await tokenFactoryChat({
    apiKey: apiKey!,
    model: model!,
    messages: [
      { role: "system", content: systemPrompt(language) },
      { role: "user", content: userPrompt({ facts: stored, messages, language }) },
    ],
    jsonSchema: { name: "memory_operations", schema: OPERATIONS_SCHEMA },
    maxTokens: 8_000,
  });
  tokensIn += reply.usage?.tokensInput ?? 0;
  tokensOut += reply.usage?.tokensOutput ?? 0;
  const { operations, dropped } = parseOperations(reply.content, stored.length, messages.length);
  const write = buildMemoryWrite(stored, operations, messages, now);
  return { write, dropped, memory: memoryAfter(stored, write) };
}

const rows: string[] = [];
const scores = [];
for (const s of golden.scenarios as Scenario[]) {
  try {
    const first = await pass(s, scenarioInput(s, now).stored);
    const score = scoreScenario(s, first.memory.map((f) => f.doc));
    const second = await pass(s, first.memory);
    const churn = second.write.insert.length + second.write.remove.length;
    scores.push(score);
    rows.push(
      `| ${s.id} | ${score.matched}/${score.expected} | ${score.kept} | ${score.precision.toFixed(2)} | ${score.recall.toFixed(2)} | ` +
        `${score.violations.join(", ") || "—"} | ${first.dropped} | ${churn} |`,
    );
  } catch (e) {
    rows.push(`| ${s.id} | error | | | | ${String(e).slice(0, 80)} | | |`);
  }
}

const t = totals(scores);
console.log(`Model: ${model} · ${now.toISOString().slice(0, 10)} · ${tokensIn} input / ${tokensOut} output tokens\n`);
console.log("| Scenario | Matched | Facts left | Precision | Recall | Violations | Dropped ops | 2nd-pass churn |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
console.log(`\n**Total:** precision ${t.precision.toFixed(2)}, recall ${t.recall.toFixed(2)}, violations ${t.violations}, over ${t.scenarios} scenarios.`);
