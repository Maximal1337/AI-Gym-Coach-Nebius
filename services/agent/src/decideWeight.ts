import { ChatOpenRouter } from "@langchain/openrouter";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { Exercise, SetLog, UnitSystem } from "@gymcoach/shared";
import { llmConfig } from "./config.js";
import { costCents, type LlmUsage } from "./llm.js";
import type { Targets } from "./progression.js";
import { formatHistory } from "./prompt.js";
import { displayWeightToKg, formatWeightForPrompt } from "./units.js";

/**
 * The working weight for an exercise is the one number that context can move
 * but the deterministic progression rules (progression.ts) can't see: a
 * saved note like "keep me at 84kg to sharpen technique" makes the user hold
 * a weight the rules would otherwise bump. That preference used to reach only
 * the coaching PROSE (the LLM reads notes) and never the target that fills
 * the interactive set component — so the two disagreed (agent said 84, the
 * component showed the computed 91).
 *
 * This closes that gap without giving the model arithmetic: it decides ONLY
 * the weight, against tightly-scoped context (the default the rules computed,
 * last time's real numbers, the saved notes), and returns it in the user's
 * own units. progression.ts then derives the reps deterministically at that
 * weight (suggestTargets' overrideWeightKg). The component and the prose both
 * end up driven by the same decision.
 *
 * Deliberately NOT run when there are no notes: a durable weight preference
 * can only live in a saved note, so with none there is nothing that could
 * override the default — skip the call and keep the common case free.
 */

const NO_USAGE: LlmUsage = { tokensInput: 0, tokensOutput: 0, costCents: 0 };

export interface WeightDecision {
  /** kg to force as the working weight, or null to use the deterministic default unchanged. */
  overrideWeightKg: number | null;
  usage: LlmUsage;
}

export async function decideWorkingWeight(params: {
  exercise: Exercise;
  lastLogs: SetLog[];
  notes: string[];
  /** What the deterministic rules already computed — the thing we're deciding whether to override. */
  defaultTargets: Targets;
  units: UnitSystem;
}): Promise<WeightDecision> {
  const { exercise, lastLogs, notes, defaultTargets, units } = params;

  // Nothing that could carry a durable weight preference, or no deterministic
  // weight to anchor against (baseline: the rules themselves defer to the
  // user) — leave the default untouched, no call.
  if (notes.length === 0) return { overrideWeightKg: null, usage: NO_USAGE };
  const defaultKg = defaultTargets.suggestedWeightKg;
  if (defaultTargets.reason === "baseline" || defaultKg == null || defaultKg <= 0) {
    return { overrideWeightKg: null, usage: NO_USAGE };
  }
  if (!process.env.OPENROUTER_API_KEY) return { overrideWeightKg: null, usage: NO_USAGE };

  const unitLabel = units === "metric" ? "kg" : "lb";

  const argsSchema = z.object({
    changed: z
      .boolean()
      .describe(
        "true ONLY if a saved note explicitly tells the user to use a specific different working weight than the default (hold/keep at a weight, cap it, or deload). false for anything else — a technique cue, encouragement, or any note that doesn't name a weight to use.",
      ),
    weight: z
      .number()
      .describe(
        `The working weight in ${unitLabel} (the same units used everywhere below). When changed is false, repeat the default weight.`,
      ),
    reason: z.string().describe("Brief reason, e.g. 'note: hold at this weight' or 'no weight preference in notes'."),
  });

  const setWorkingWeight = tool(async () => "recorded", {
    name: "setWorkingWeight",
    description: "Report the working weight to use for this exercise today. Call this exactly once.",
    schema: argsSchema,
  });

  const prompt = [
    `Exercise: ${exercise.name} (${exercise.equipmentType ?? "unknown equipment"}), rep range ${exercise.repRange}. Weights below are in ${unitLabel}.`,
    "",
    "Last time on this exercise:",
    formatHistory(lastLogs, units),
    "",
    `Default working weight for today, from the progressive-overload rules: ${formatWeightForPrompt(defaultKg, units)}.`,
    "",
    "Saved notes about this exercise:",
    ...notes.map((n) => `- ${n}`),
    "",
    "Your ONLY job: decide the working weight for this exercise today, then call setWorkingWeight once.",
    `Use the default (${formatWeightForPrompt(defaultKg, units)}) UNLESS one of the saved notes above explicitly tells the user to use a specific different working weight — asking to stay/keep at a weight, to cap it, or to deload. In that case use the weight the note names.`,
    "A technique cue, a reminder, or general encouragement is NOT a weight instruction — when a note doesn't clearly name a working weight to use, keep the default and set changed=false.",
    "Only decide the weight. Never compute reps. Never invent a weight that isn't the default or one grounded in the notes/history.",
  ].join("\n");

  const model = new ChatOpenRouter({
    model: llmConfig.model,
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens: llmConfig.maxOutputTokens,
    temperature: 0, // a deterministic decision, not creative writing
    siteName: "Notch",
  }).bindTools([setWorkingWeight], { tool_choice: "setWorkingWeight" });

  let usage: LlmUsage = NO_USAGE;
  let decided: { changed: boolean; weight: number } | null = null;
  try {
    const res = await model.invoke([["human", prompt]]);
    const tokensInput = res.usage_metadata?.input_tokens ?? 0;
    const tokensOutput = res.usage_metadata?.output_tokens ?? 0;
    usage = { tokensInput, tokensOutput, costCents: costCents(tokensInput, tokensOutput) };
    const call = (res.tool_calls ?? []).find((c) => c.name === "setWorkingWeight");
    const parsed = call ? argsSchema.safeParse(call.args) : null;
    if (parsed?.success) decided = parsed.data;
  } catch {
    // A failed decision must never break the turn — fall back to the default.
    return { overrideWeightKg: null, usage };
  }

  if (!decided || !decided.changed || !Number.isFinite(decided.weight)) {
    return { overrideWeightKg: null, usage };
  }

  const kg = displayWeightToKg(decided.weight, units);
  // Guardrails against a nonsensical value. Asymmetric on purpose: a weight
  // LIGHTER than the default is always safe (worst case the user under-loads),
  // so allow deep deloads down to 20% for rehab-style notes ("drop to 25 for
  // my knee") and only reject a near-zero misread. A HEAVIER weight is the
  // risky direction (the user could load and attempt it), and a note almost
  // never legitimately asks to go above the already-progressed default — so
  // cap the upper side tightly at 1.5x, which also rejects an exactly-doubled
  // misread. Outside the band => fall back to the deterministic default.
  if (kg < defaultKg * 0.2 || kg > defaultKg * 1.5) {
    return { overrideWeightKg: null, usage };
  }
  // Essentially the default already — no need to diverge the two surfaces.
  if (Math.abs(kg - defaultKg) < 0.5) {
    return { overrideWeightKg: null, usage };
  }
  return { overrideWeightKg: kg, usage };
}
