import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { llmConfig } from "./config.js";
import { extractJson } from "./util.js";
import { conversationReplySchema } from "./schema.js";

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

export interface ComposedConversationReply {
  message: string;
  loggedSets: Array<{ weightKg: number; reps: number }>;
  advance: boolean;
  usage: LlmUsage;
  degraded: boolean;
  noteToSave: { text: string; general: boolean } | null;
}

/**
 * Free-text mid-workout turn (GYM-61/67): one call that both interprets
 * the user's message (into structured loggedSets/advance) and composes
 * the narrative reply, so a turn stays at one LLM call regardless of
 * whether the user is reporting a set or renegotiating.
 */
/**
 * Genuine few-shot turns (not prose description of the rule) for the one
 * failure mode that survived two rounds of tightening the prose instead:
 * a pure note/reminder request getting logged as if it were a completed
 * report. Modeled as real conversation turns — Gemini "having already
 * produced" the correct JSON once tends to pin down an exact input-shape
 * decision far more reliably than describing the rule in words, which
 * this project already tried twice on this exact bug.
 */
const FEW_SHOT_TURNS: Array<["human" | "ai", string]> = [
  [
    "human",
    'EXAMPLE (not the real conversation, just showing you the correct output shape) — user message: "תזכיר לי ללחוץ עד הסוף עם המשקולת" — no numbers, purely a reminder request, even though a target was already suggested earlier. What JSON do you output?',
  ],
  [
    "ai",
    '{"message":"רשמתי לי את זה — אזכיר לך בפעם הבאה! 💪","loggedSets":[],"advance":false,"noteToSave":{"text":"ללחוץ עד הסוף עם המשקולת","general":false}}',
  ],
  [
    "human",
    'EXAMPLE — user message: "סיימתי" — a bare standalone confirmation, nothing else, and a target of 16kg x 8/8/8 was already agreed. What JSON do you output?',
  ],
  [
    "ai",
    '{"message":"מעולה, רשמתי 16 קילו לשלושה סטים של 8! 💪","loggedSets":[{"weightKg":16,"reps":8},{"weightKg":16,"reps":8},{"weightKg":16,"reps":8}],"advance":true,"noteToSave":null}',
  ],
  [
    "human",
    'EXAMPLE — user message: "עשיתי 58 קילו ל-10, 10, ו-9 חזרות" — an actual numeric report. What JSON do you output?',
  ],
  [
    "ai",
    '{"message":"כל הכבוד! רשמתי 58 קילו ל-10, 10, 9 חזרות 💪","loggedSets":[{"weightKg":58,"reps":10},{"weightKg":58,"reps":10},{"weightKg":58,"reps":9}],"advance":true,"noteToSave":null}',
  ],
];

export async function composeConversationTurn(
  systemPrompt: string,
  turnPrompt: string,
): Promise<ComposedConversationReply | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  const model = new ChatGoogleGenerativeAI({
    model: llmConfig.model,
    apiKey: process.env.GEMINI_API_KEY,
    maxOutputTokens: 1000,
    temperature: llmConfig.temperature,
  });

  const res = await model.invoke([
    ["system", systemPrompt],
    ...FEW_SHOT_TURNS,
    ["human", turnPrompt],
  ]);

  const raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  const parsed = conversationReplySchema.parse(extractJson(raw));
  const tokensInput = res.usage_metadata?.input_tokens ?? 0;
  const tokensOutput = res.usage_metadata?.output_tokens ?? 0;
  return {
    ...parsed,
    usage: { tokensInput, tokensOutput, costCents: costCents(tokensInput, tokensOutput) },
    degraded: false,
  };
}
