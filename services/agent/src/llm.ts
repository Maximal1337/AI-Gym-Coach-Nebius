import { ChatOpenRouter } from "@langchain/openrouter";
import { llmConfig } from "./config.js";

export interface LlmUsage {
  tokensInput: number;
  tokensOutput: number;
  costCents: number;
}

/** Gemini 3.1 Flash-Lite pricing, in cents per token. */
const CENTS_PER_INPUT_TOKEN = 25 / 1_000_000; // $0.25 / M
const CENTS_PER_OUTPUT_TOKEN = 150 / 1_000_000; // $1.50 / M

export function costCents(tokensInput: number, tokensOutput: number): number {
  return (
    tokensInput * CENTS_PER_INPUT_TOKEN + tokensOutput * CENTS_PER_OUTPUT_TOKEN
  );
}

export interface ComposedReply {
  message: string;
  usage: LlmUsage;
  /** True when no OPENROUTER_API_KEY is configured and a deterministic fallback answered. */
  degraded: boolean;
}

export async function composeWithLlm(
  systemPrompt: string,
  turnPrompt: string,
): Promise<ComposedReply | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;

  const model = new ChatOpenRouter({
    model: llmConfig.model,
    apiKey: process.env.OPENROUTER_API_KEY,
    // GYM-51: hard per-call output ceiling — enforced at the API level.
    maxTokens: llmConfig.maxOutputTokens,
    temperature: llmConfig.temperature,
    siteName: "Notch",
  });

  const res = await model.invoke([
    ["system", systemPrompt],
    ["human", turnPrompt],
  ]);

  const tokensInput = res.usage_metadata?.input_tokens ?? 0;
  const tokensOutput = res.usage_metadata?.output_tokens ?? 0;
  return {
    message: typeof res.content === "string" ? res.content : JSON.stringify(res.content),
    usage: {
      tokensInput,
      tokensOutput,
      costCents: costCents(tokensInput, tokensOutput),
    },
    degraded: false,
  };
}

