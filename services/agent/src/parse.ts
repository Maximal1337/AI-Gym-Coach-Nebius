import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import { llmConfig } from "./config.js";

/**
 * Paste-and-parse (GYM-26 / GYM-48): free text in, structured rows out.
 * Temperature 0, JSON-only replies, zod-validated — a parse either
 * round-trips the schema or fails loudly; nothing half-parsed is saved.
 */

export const parsedPlanSchema = z.object({
  plans: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        exercises: z
          .array(
            z.object({
              orderIndex: z.number().int().min(1),
              name: z.string().min(1).max(200),
              sets: z.number().int().min(1).max(20),
              repRange: z.string().max(20),
              restSec: z.number().int().min(0).max(1800),
              intensity: z.string().max(200),
              warmup: z.string().max(300).nullable(),
            }),
          )
          .min(1)
          .max(30),
      }),
    )
    .min(1)
    .max(10),
});
export type ParsedPlan = z.infer<typeof parsedPlanSchema>;

export const parsedSummarySchema = z.object({
  sessions: z
    .array(
      z.object({
        date: z.string().max(30).nullable(),
        planName: z.string().max(120).nullable(),
        logs: z
          .array(
            z.object({
              exerciseName: z.string().min(1).max(200),
              setNo: z.number().int().min(1).max(20),
              weightKg: z.number().min(0),
              reps: z.number().int().min(0).max(200),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .min(1)
    .max(20),
});
export type ParsedSummary = z.infer<typeof parsedSummarySchema>;

function parseModel(): ChatGoogleGenerativeAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  return new ChatGoogleGenerativeAI({
    model: llmConfig.model,
    apiKey: process.env.GEMINI_API_KEY,
    maxOutputTokens: 4096, // parsing a full plan legitimately needs more than a chat reply
    temperature: 0,
  });
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(trimmed);
}

export async function parsePlanText(text: string): Promise<ParsedPlan | null> {
  const model = parseModel();
  if (!model) return null;
  const res = await model.invoke([
    [
      "system",
      "You convert pasted workout plans (any language) into JSON. Reply with ONLY valid JSON matching: {\"plans\":[{\"name\":string,\"exercises\":[{\"orderIndex\":number,\"name\":string,\"sets\":number,\"repRange\":\"6-10\",\"restSec\":number,\"intensity\":string,\"warmup\":string|null}]}]}. Each distinct workout (e.g. 'Workout A', 'Workout B') is one plan entry. Keep exercise names in the original language. restSec in seconds. If sets count is a range, use the higher number.",
    ],
    ["human", text],
  ]);
  const raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  return parsedPlanSchema.parse(extractJson(raw));
}

export async function parseSummaryText(
  text: string,
  knownExercises: string[],
): Promise<ParsedSummary | null> {
  const model = parseModel();
  if (!model) return null;
  const res = await model.invoke([
    [
      "system",
      `You convert pasted workout-summary text (any language) into JSON. Reply with ONLY valid JSON matching: {"sessions":[{"date":string|null,"planName":string|null,"logs":[{"exerciseName":string,"setNo":number,"weightKg":number,"reps":number}]}]}. "date" must be ISO format YYYY-MM-DD (convert from any format, e.g. 23.07.2026 -> "2026-07-23") or null if absent. When an exercise clearly matches one of these known exercise names, use the known name EXACTLY: ${JSON.stringify(knownExercises)}. Otherwise keep the original name.`,
    ],
    ["human", text],
  ]);
  const raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  return parsedSummarySchema.parse(extractJson(raw));
}
