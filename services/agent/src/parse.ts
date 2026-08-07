import { ChatOpenRouter } from "@langchain/openrouter";
import { extractRawText } from "mammoth";
import { z } from "zod";
import { llmConfig } from "./config.js";
import { extractJson } from "./util.js";
import { equipmentTypeSchema } from "./schema.js";

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
              equipmentType: equipmentTypeSchema.nullable(),
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

function parseModel(): ChatOpenRouter | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return new ChatOpenRouter({
    model: llmConfig.model,
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens: 4096, // parsing a full plan legitimately needs more than a chat reply
    temperature: 0,
    siteName: "Notch",
  });
}

const PLAN_PARSE_SYSTEM_PROMPT =
  "You convert workout plans (any language, as pasted text, an uploaded PDF, or one or more photos of a printed page) into JSON. Reply with ONLY valid JSON matching: {\"plans\":[{\"name\":string,\"exercises\":[{\"orderIndex\":number,\"name\":string,\"sets\":number,\"repRange\":string,\"restSec\":number,\"intensity\":string,\"warmup\":string|null,\"equipmentType\":\"barbell\"|\"dumbbell\"|\"machine\"|\"cable\"|\"bodyweight\"|\"other\"|null}]}]}. Each distinct workout (e.g. 'Workout A', 'Workout B') is one plan entry. \"name\" must be descriptive, not just the bare label: if the source already states which muscle groups/body parts that workout targets, use that; otherwise infer the muscle groups from the exercises included in that workout and append them, formatted as \"<label> - <muscle group 1>/<muscle group 2>/...\" ordered by how much of the workout targets each group (e.g. \"Workout A - Chest/Legs/Triceps\"), in the same language as the source. Keep exercise names in the original language. restSec in seconds. If sets count is a range, use the higher number. \"repRange\" MUST be copied from what the source actually says for that exercise (e.g. \"8-12\", \"10\", \"12-15\", \"AMRAP\") — never default to a generic range like \"6-10\" or reuse another exercise's range; if the source genuinely states no rep count anywhere for that exercise, use your best guess from the stated intensity/goal instead of a placeholder. \"warmup\" should capture any warm-up guidance tied to that exercise (e.g. lighter warm-up sets before the work sets, or a general warm-up routine like light cardio/stretching mentioned at the start of the workout — attach a session-level warm-up like that to the FIRST exercise's warmup field); use null only when the source gives no warm-up guidance at all for that exercise. Infer equipmentType from the exercise name (e.g. \"Barbell Squat\"->barbell, \"Dumbbell Curl\"->dumbbell, \"Leg Press machine\"->machine, \"Cable Row\"->cable, \"Push-up\"->bodyweight) — this determines what weight increment the exercise can realistically jump by, so a plain unqualified free-weight exercise name that's ambiguous between barbell and dumbbell should still use your best guess from common gym conventions, not null; use null only when you genuinely cannot infer any equipment (e.g. \"stretch\", \"plank\").";

/** A pasted plan, an uploaded file, or one or more photographed pages (base64, no data: prefix) — same parse, different input shape. */
export type PlanSource =
  | { text: string }
  | { pdfBase64: string; filename: string }
  | { docxBase64: string; filename: string }
  | { imagesBase64: string[] };

/** Plain-text .docx extraction — mammoth reads the real paragraph/table text, not markup. */
export async function textFromDocx(docxBase64: string): Promise<string> {
  const { value } = await extractRawText({ buffer: Buffer.from(docxBase64, "base64") });
  return value;
}

async function parsePlanFromText(text: string): Promise<string | null> {
  const model = parseModel();
  if (!model) return null;
  const res = await model.invoke([
    ["system", PLAN_PARSE_SYSTEM_PROMPT],
    ["human", text],
  ]);
  return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
}

/**
 * PDF uploads go straight to OpenRouter's HTTP API instead of through
 * ChatOpenRouter. Verified directly: the exact same request sent raw
 * succeeds in ~2s; the identical content sent via ChatOpenRouter's "file"
 * content-block conversion hangs for 90s+ and then 500s. That's a bug in
 * this package version's block-to-wire translation, not in the request
 * itself — the fix is bypassing it for this one call, not chasing the
 * translation layer. (.docx isn't a Gemini-native input type at all —
 * that one goes through mammoth's plain-text extraction instead, then
 * the same text path as a pasted plan.)
 */
async function parsePlanPdf(pdfBase64: string, filename: string): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://docs.langchain.com/oss",
      "X-Title": "Notch",
    },
    body: JSON.stringify({
      model: llmConfig.model,
      temperature: 0,
      max_tokens: 4096,
      messages: [
        { role: "system", content: PLAN_PARSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the workout plan from this PDF." },
            { type: "file", file: { filename, file_data: `data:application/pdf;base64,${pdfBase64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.choices?.[0]?.message?.content ?? null;
}

/**
 * Photographed pages (guidelines/photograph-plan.html) — same raw-fetch
 * approach as parsePlanPdf, for the same reason: ChatOpenRouter's own
 * content-block conversion is the proven-unreliable layer here, not the
 * request itself. One call across all pages, not one per page, so
 * exercises split across a page break still land in one plan.
 */
async function parsePlanImages(imagesBase64: string[]): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const instruction = imagesBase64.length > 1
    ? `Extract the workout plan from these ${imagesBase64.length} photographed pages of a printed sheet — they're pages of the same plan (in page order), so combine them into one coherent plan rather than treating each page separately.`
    : "Extract the workout plan from this photo of a printed page.";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://docs.langchain.com/oss",
      "X-Title": "Notch",
    },
    body: JSON.stringify({
      model: llmConfig.model,
      temperature: 0,
      max_tokens: 4096,
      messages: [
        { role: "system", content: PLAN_PARSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            ...imagesBase64.map((b64) => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${b64}` },
            })),
          ],
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.choices?.[0]?.message?.content ?? null;
}

export async function parsePlanText(source: PlanSource): Promise<ParsedPlan | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;

  let raw: string | null;
  if ("text" in source) {
    raw = await parsePlanFromText(source.text);
  } else if ("pdfBase64" in source) {
    raw = await parsePlanPdf(source.pdfBase64, source.filename);
  } else if ("imagesBase64" in source) {
    raw = await parsePlanImages(source.imagesBase64);
  } else {
    const extracted = await textFromDocx(source.docxBase64);
    if (!extracted.trim()) return null;
    raw = await parsePlanFromText(extracted);
  }
  if (!raw) return null;
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
