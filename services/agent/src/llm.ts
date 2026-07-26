import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { llmConfig } from "./config.js";

export interface LlmUsage {
  tokensInput: number;
  tokensOutput: number;
  costCents: number;
}

/** Gemini 2.5 Flash-Lite pricing, in cents per token. */
const CENTS_PER_INPUT_TOKEN = 10 / 1_000_000; // $0.10 / M
const CENTS_PER_OUTPUT_TOKEN = 40 / 1_000_000; // $0.40 / M

export function costCents(tokensInput: number, tokensOutput: number): number {
  return (
    tokensInput * CENTS_PER_INPUT_TOKEN + tokensOutput * CENTS_PER_OUTPUT_TOKEN
  );
}

export interface ComposedReply {
  message: string;
  usage: LlmUsage;
  /** True when no GEMINI_API_KEY is configured and a deterministic fallback answered. */
  degraded: boolean;
}

export async function composeWithLlm(
  systemPrompt: string,
  turnPrompt: string,
): Promise<ComposedReply | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  const model = new ChatGoogleGenerativeAI({
    model: llmConfig.model,
    apiKey: process.env.GEMINI_API_KEY,
    // GYM-51: hard per-call output ceiling — enforced at the API level.
    maxOutputTokens: llmConfig.maxOutputTokens,
    temperature: llmConfig.temperature,
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
