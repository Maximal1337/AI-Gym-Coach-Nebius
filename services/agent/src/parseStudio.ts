import { ChatOpenRouter } from "@langchain/openrouter";
import { z } from "zod";
import { llmConfig } from "./config.js";
import { extractJson } from "./util.js";
import { textFromDocx, type PlanSource } from "./parse.js";

/**
 * Studio-board parsing (whiteboard/paste/upload → blocks, scaling tiers,
 * per-side reps, rep ladders, per-movement units) — a fully separate
 * pipeline from parse.ts's gym parsedPlanSchema, because the Studio tab is
 * the only entry point (no gym/studio classification needed here — see
 * guidelines/studio-workout-entry.html's own correction against a merged
 * auto-classifying entry).
 */

// A "present but nullable" zod field still requires the KEY to exist — an
// LLM routinely omits a field entirely instead of writing an explicit
// `null` for it (this bit the first version of this schema: parseConfidence
// and less-common format params came back missing, not null, and a
// strictly-required key failed the whole parse for an otherwise-good read).
// Every optional field here is `.nullish()` (accepts missing OR null) with
// a `.transform` that collapses both to `null`, so a schema mismatch never
// throws out a real parse over a field the model simply left out.
const nullish = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((v) => v ?? null);

// Deliberately a loose key->number record rather than a discriminated union
// keyed to formatType, for the same reason: the model sometimes omits one
// param of a pair (an EMOM with only "every" written, say). normalizeFormats
// below fills in any missing key with a sane default rather than failing.
const studioFormatTypeSchema = z.enum(["buyin", "rounds", "fortime", "amrap", "emom", "intervals", "custom"]);

// tiers/tierIndex are the coach's scaling ladder ("40/45/50" -> three
// levels, or "15/20"/"8-10 reps" -> two). perSide is the *other* thing a
// slash pattern means ("6/6", "8/8" — one value, done each side, NOT two
// tiers of the same number). ladder is a third, unrelated shape
// ("10-8-6-3-3 Deadlift" — one value per round). The three are mutually
// exclusive; normalizeMetrics below enforces that regardless of what the
// model produced, since it's a completely different data shape depending on
// which one applies and a misread here corrupts the exercise silently.
const studioMetricSchema = z.object({
  unit: z.string().min(1).max(20),
  value: z.number().min(0).max(5000),
  tiers: nullish(z.array(z.number().min(0).max(5000)).min(2).max(5)),
  tierIndex: nullish(z.number().int().min(0).max(4)),
  perSide: z.boolean().nullish().transform((v) => v ?? false),
  ladder: nullish(z.array(z.number().min(0).max(2000)).min(3).max(20)),
});

const studioExerciseSchema = z.object({
  name: z.string().min(1).max(200),
  // Set when the movement name or its unit couldn't be matched with
  // confidence — renders the amber flag, never blocks the parse.
  parseConfidence: nullish(z.literal("low")),
  // One metric, plus an optional second (e.g. a farmer's carry is a
  // distance AND a load) — never more; that's the UI's own ceiling.
  metrics: z.array(studioMetricSchema).min(1).max(2),
});

// Flat formatType/formatParams/formatCustom, matching exactly what
// supabase/functions/studio-session/index.ts's Tree type stores — no nested
// `format` object to translate between agent output and the DB write path.
const studioBlockSchema = z.object({
  // null = the board has no numbered blocks; still exactly one block,
  // wrapping every exercise, so a flat-list board is a normal parse result.
  // Numbered STATIONS trainees rotate between (rather than blocks done in
  // sequence) are structurally identical — no separate entity — but get
  // literally named "Station N" (see prompt) instead of the board's own
  // label, so StudioSessionScreen's client-side name match can offer
  // "rounds you got through" for them.
  name: nullish(z.string().max(120)),
  // null = the board never wrote a format for this block — most blocks on
  // a real board don't have one, and that's not the same thing as 'buyin'
  // (a real, distinct format for a bookending buy-in/buy-out pairing).
  formatType: nullish(studioFormatTypeSchema),
  formatParams: z.record(z.string(), z.number()).default({}),
  formatCustom: nullish(z.string().max(60)),
  exercises: z.array(studioExerciseSchema).min(1).max(30),
});

export const parsedStudioWorkoutSchema = z.object({
  // Falls back rather than failing the whole parse over a missing title —
  // every other field here is the actual content the trainee needs.
  name: z.string().max(120).nullish().transform((v) => (v && v.trim()) || "Studio workout"),
  blocks: z.array(studioBlockSchema).min(1).max(20),
  // Only set when the board implies ONE overall result to record (a
  // for-time/AMRAP/EMOM finisher, a benchmark strength lift) — null for a
  // circuit board (buy-in/buy-out, fixed rounds, intervals), where everyone
  // finishes on the coach's clock and the per-exercise values already
  // captured under each block ARE the result.
  scoreType: nullish(z.enum(["fortime", "amrap", "emom", "strength"])),
});
export type ParsedStudioWorkout = z.infer<typeof parsedStudioWorkoutSchema>;

/** Enforces the three-way mutual exclusivity (ladder / perSide / tiers) the
 * schema can't express on its own (each metric field is validated
 * independently), normalizes tiers/tierIndex/value the same way the
 * original tier-only version did, and — since "the ladder's length IS the
 * block's round count" — syncs a laddered block's own round count to match,
 * so the two numbers can never disagree even when the model produced them
 * independently. Also the same defense as before: studio-session's
 * `validMetric` rejects a self-inconsistent metric (e.g. tierIndex set with
 * tiers null) the moment the client's first autosave sends the tree back,
 * so this has to run before the tree ever leaves the parser. */
export function normalizeMetrics(workout: ParsedStudioWorkout): ParsedStudioWorkout {
  for (const block of workout.blocks) {
    let maxLadderLen = 0;
    for (const exercise of block.exercises) {
      for (const metric of exercise.metrics) {
        if (metric.ladder && metric.ladder.length >= 3) {
          metric.tiers = null;
          metric.tierIndex = null;
          metric.perSide = false;
          metric.value = metric.ladder[0];
          maxLadderLen = Math.max(maxLadderLen, metric.ladder.length);
          continue;
        }
        metric.ladder = null;

        if (metric.perSide) {
          metric.tiers = null;
          metric.tierIndex = null;
          continue;
        }

        if (!metric.tiers || metric.tiers.length < 2) {
          metric.tiers = null;
          metric.tierIndex = null;
          continue;
        }
        if (metric.tierIndex == null || metric.tierIndex >= metric.tiers.length) {
          metric.tierIndex = Math.floor((metric.tiers.length - 1) / 2);
        }
        metric.value = metric.tiers[metric.tierIndex];
      }
    }
    if (maxLadderLen > 0 && (block.formatType == null || block.formatType === "rounds")) {
      block.formatType = "rounds";
      block.formatParams = { ...block.formatParams, count: maxLadderLen };
    }
  }
  return workout;
}

const FORMAT_PARAM_SPEC: Record<string, Record<string, { def: number; min: number; max: number }>> = {
  buyin: {},
  fortime: {},
  rounds: { count: { def: 3, min: 1, max: 50 } },
  amrap: { cap: { def: 12, min: 1, max: 120 } },
  emom: { every: { def: 1, min: 1, max: 30 }, total: { def: 10, min: 1, max: 180 } },
  intervals: { on: { def: 30, min: 5, max: 600 }, off: { def: 30, min: 5, max: 600 } },
  custom: {},
};

/** Fills any format param the model left out with a sane default and clamps
 * whatever it did provide into bounds, instead of trusting free-form model
 * numbers straight into a column the DB doesn't itself range-check. A null
 * formatType (no format written on the board for this block) always gets
 * empty params and no custom text — there's nothing to normalize. Runs
 * after normalizeMetrics, so a ladder-derived round count is already in
 * formatParams.count by the time this clamps it into bounds. */
export function normalizeFormats(workout: ParsedStudioWorkout): ParsedStudioWorkout {
  for (const block of workout.blocks) {
    if (block.formatType == null) {
      block.formatParams = {};
      block.formatCustom = null;
      continue;
    }
    const spec = FORMAT_PARAM_SPEC[block.formatType] ?? {};
    const params: Record<string, number> = {};
    for (const [key, { def, min, max }] of Object.entries(spec)) {
      const v = block.formatParams[key];
      params[key] = typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
    }
    block.formatParams = params;
    if (block.formatType === "custom" && !block.formatCustom) block.formatCustom = "Custom";
    if (block.formatType !== "custom") block.formatCustom = null;
  }
  return workout;
}

function parseModel(): ChatOpenRouter | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return new ChatOpenRouter({
    model: llmConfig.model,
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens: 4096,
    temperature: 0,
    siteName: "Notch",
  });
}

const STUDIO_PARSE_SYSTEM_PROMPT =
  "You convert a studio/class workout board (functional fitness, CrossFit-style, HIIT — any language, as pasted text, an uploaded file, or one or more photos of a handwritten whiteboard) into JSON. Reply with ONLY valid JSON matching: {\"name\":string,\"scoreType\":\"fortime\"|\"amrap\"|\"emom\"|\"strength\"|null,\"blocks\":[{\"name\":string|null,\"formatType\":\"buyin\"|\"rounds\"|\"fortime\"|\"amrap\"|\"emom\"|\"intervals\"|\"custom\"|null,\"formatParams\":{...},\"formatCustom\":string|null,\"exercises\":[{\"name\":string,\"parseConfidence\":\"low\"|null,\"metrics\":[{\"unit\":string,\"value\":number,\"tiers\":number[]|null,\"tierIndex\":number|null,\"perSide\":boolean,\"ladder\":number[]|null}]}]}]}. formatParams keys by formatType: buyin/fortime/custom/null -> {} (omit entirely), rounds -> {\"count\":number}, amrap -> {\"cap\":number} (minutes), emom -> {\"every\":number,\"total\":number} (both minutes), intervals -> {\"on\":number,\"off\":number} (both seconds). formatCustom is only used (a short literal label) when formatType is \"custom\" — null otherwise. Every field except name/exercises/metrics/unit/value may be omitted entirely instead of written as null if you prefer — both are treated the same, and perSide defaults to false, ladder to null, when left out. "
  + "\"name\" is a short title for the whole board (use one if written, e.g. \"Strike Off\"; otherwise invent a short descriptive one from the movements, in the source language). "
  + "BLOCKS: numbered circles/labels on the board are block boundaries, and the word beside the number is that block's name — copy it into \"name\". EXCEPTION — STATIONS: when the board is numbered stations that trainees physically rotate between (signalled by words like \"stations\", \"rotate\", \"rotate every X min\", \"move to next station on the buzzer\", or a coach explaining a circuit where everyone starts at a different numbered spot), name each of those blocks literally \"Station 1\", \"Station 2\", etc. (the word \"Station\" plus its number) INSTEAD of copying the movement label beside it — the app uses this literal name to offer a \"rounds you got through\" field, so it must say \"Station\", not the movement. This is the one case where you do not copy the board's own label verbatim. Ordinary sequential blocks (done one after another, not rotated between) keep their real board label as before — never label a plain sequential block \"Station N\" just because it's numbered. If the board has NO numbered sections at all, it is a flat list: return exactly ONE block with \"name\": null containing every exercise, never invent a block label like \"1\". Never split a board into blocks it doesn't actually have. "
  + "FORMAT: read each block's own notation literally — \"EMOM\" -> emom (work out the interval and total minutes from context, default every=1 if only one number is given), \"(3 ROUNDS)\"/\"3 RFT\" -> rounds with count=3, \"30 ON 30 OFF\" -> intervals with on=30,off=30 (seconds), \"AMRAP 12\" -> amrap with cap=12 (minutes), \"FOR TIME\" -> fortime, movements that explicitly bookend a piece as a buy-in and a buy-out pairing -> buyin, anything else with its own written format you can't map to these -> custom with formatCustom set to the literal text. formatType is null whenever the block simply has no format written on the board at all — most blocks don't. This is NOT the same as buyin: buyin is a real, specific structure (a bookending pair), and defaulting an unmarked block to it invents a structure the board never stated. Only use buyin when the board actually shows that bookending pattern; leave formatType null for a plain, unmarked list of movements. If you genuinely can't tell a param's number, omit that key rather than guessing wildly — a missing param gets a sane default, a wrong one doesn't. NEVER put a format word (AMRAP, EMOM, rounds, buy-in) into an exercise name or its reps/value — it always belongs on the block's format fields, never on a metric. "
  + "TIERS vs PER-SIDE vs LADDER — read this exactly, since misreading it corrupts every unilateral movement on a board: (1) THREE OR MORE ascending slash-separated values (\"40/45/50\") are scaling TIERS — the coach's own beginner/intermediate/as-prescribed ladder, never alternatives and never just the highest number. Set \"tiers\" to the full ordered array, \"tierIndex\" to the middle index (Math.floor((tiers.length-1)/2)), \"value\" to tiers[tierIndex]. (2) TWO DIFFERENT values, whether slash- or hyphen-separated (\"15/20\", \"8-10 reps\", \"20/14 KG\") are ALSO tiers — a two-level ladder — handled the same way, tierIndex defaulting to 0 (the lower/first value); this includes a pair carrying a weight unit (\"20/14 KG\", a gendered-load pair) — still tiers, never perSide. (3) TWO IDENTICAL values (\"6/6\", \"8/8\") are PER-SIDE, not tiers — a single value performed on each side, not a choice between two equal numbers. Set \"perSide\":true, \"value\" to that one number, \"tiers\" and \"tierIndex\" both null. This is overwhelmingly what a matched pair means for a unilateral movement — pistol squat, lunge (any variant), single-leg RDL, single-arm row, step-up, split squat, Bulgarian split squat, single-arm press, gorilla row, side plank, single-leg glute bridge, and similar one-limb-at-a-time movements — so treat a matched pair on one of these as perSide essentially always. A single plain number with no slash or hyphen has tiers/tierIndex null and perSide false. "
  + "LADDERS: THREE OR MORE hyphen-separated integers written immediately before a movement name (\"10-8-6-3-3 Deadlift\") are a rep ladder, not tiers — one value per round, usually descending as the trainee tires through the station. Set \"ladder\" to the full ordered array in board order (first number = round 1), \"value\" to ladder[0] as a fallback, and leave tiers/tierIndex null and perSide false — a ladder is never also tiers or per-side. Do not confuse this with a two-value hyphenated rep RANGE (\"8-10 reps\") — exactly two values, ascending, usually followed by a unit word — which is tiers (see above), not a ladder; a ladder is specifically three or more values. A ladder's length is the number of rounds run at that station: whenever a block contains a laddered exercise and its own format is unwritten or already \"rounds\", set formatType to \"rounds\" and formatParams.count to that ladder's own length — they describe the same number on the board and must agree. "
  + "UNITS: read the unit the board actually wrote when it wrote one (\"CALS\"->cals, \"M\"/\"METRES\"->m, \"LENGTHS\"->lengths, \"KG\"/\"KGS\"->kg, \"LB\"/\"LBS\"/\"POUNDS\"->lbs, \"CM\"->cm, a bare time like \"1:30\" or \"MIN\"->min, \"SEC\"->sec). A board that writes a bare loaded-weight number with no unit at all defaults to kg, never lbs — only use lbs when the board explicitly writes it, the same way a coach's actual units on the board always win over any assumption. Where no unit is written, infer the default for that kind of movement: an erg/bike/row machine defaults to cals or m depending on what number is given, a loaded carry defaults to lengths or m, a plain bodyweight movement (burpees, wall balls, box jumps, lunges, pull-ups, push-ups, sit-ups) defaults to reps. If a movement genuinely has a second, unwritten dimension a trainee would know (e.g. a farmer's carry implies a load, a weighted movement implies kg) do NOT invent a value for it — leave it as a single metric; the trainee adds a second unit themselves later. When you are not confident in a name or a unit, still include the row with your best guess and set \"parseConfidence\":\"low\" rather than dropping it or refusing to parse — an imperfect row is always better than a missing one. "
  + "AMRAP/EMOM/ROUNDS/FOR TIME and similar words are scoring/format types, never a rep count or an exercise name by themselves — they always land on a block's format fields. "
  + "\"scoreType\" (top-level, not per-block): set it ONLY when the board clearly wants ONE overall number recorded for the whole session — e.g. the entire board is a single for-time/AMRAP/EMOM piece, or it's explicitly a benchmark strength lift (\"1RM\", \"find your heavy single/triple\") -> \"strength\". Leave it null for a circuit board made of buy-in/buy-out pairings, fixed-round blocks, or intervals, where every block is time-boxed by the coach and everyone finishes together — there, the per-exercise values already captured under each block ARE the result, and asking for one more number on top would be a number nobody has.";

/** Appended as extra instruction when this is a re-parse ("Did I get
 * something wrong?") rather than a first read — the trainee's own words
 * about what the FIRST read got wrong, sent back alongside the SAME
 * original source AND that first read's own JSON result — a correction is a
 * SMALL, targeted fix, not a blind re-parse: without the previous result the
 * model has to re-derive the entire board from zero, which risks silently
 * changing rows the trainee never flagged (and may have already hand-edited
 * in the app) instead of just fixing the one thing they pointed at. */
function withCorrection(
  text: string,
  correctionNote?: string | null,
  previousResult?: ParsedStudioWorkout | null,
): string {
  if (!correctionNote || !correctionNote.trim()) return text;
  if (previousResult) {
    return `${text}\n\n---\nThis is a correction pass, not a fresh parse. Here is exactly what was extracted from this same board last time (the trainee may have hand-edited some rows in the app since this was read) — JSON: ${
      JSON.stringify(previousResult)
    }\n\nThe trainee reviewed that result and said: "${correctionNote.trim()}"\n\nRe-check the board only to resolve what their note describes, then return the FULL workout with ONLY that change applied — every other block, exercise, value, unit, and format must come back exactly as shown in the JSON above. Do not re-derive or "improve" anything the note doesn't mention, even if a fresh read might phrase it slightly differently.`;
  }
  return `${text}\n\n---\nA trainee already reviewed a previous read of this exact board and said this about what it got wrong: "${correctionNote.trim()}". Re-read the board from scratch with that correction in mind, and trust it over your own first impression wherever the two conflict.`;
}

async function parseStudioFromText(
  text: string,
  correctionNote?: string | null,
  previousResult?: ParsedStudioWorkout | null,
): Promise<string | null> {
  const model = parseModel();
  if (!model) return null;
  const res = await model.invoke([
    ["system", STUDIO_PARSE_SYSTEM_PROMPT],
    ["human", withCorrection(text, correctionNote, previousResult)],
  ]);
  return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
}

/** Same raw-fetch approach as parse.ts's parsePlanPdf/parsePlanImages — see
 * that file's comment on why ChatOpenRouter's own file/image content-block
 * conversion is bypassed for these two input shapes. */
async function parseStudioPdf(
  pdfBase64: string,
  filename: string,
  correctionNote?: string | null,
  previousResult?: ParsedStudioWorkout | null,
): Promise<string | null> {
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
        { role: "system", content: STUDIO_PARSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: withCorrection("Extract the studio workout board from this file.", correctionNote, previousResult) },
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

/** One call across all photos, not one per photo, so a board split across
 * two shots (e.g. a wide whiteboard) still lands in one workout. */
async function parseStudioImages(
  imagesBase64: string[],
  correctionNote?: string | null,
  previousResult?: ParsedStudioWorkout | null,
): Promise<string | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const instruction = imagesBase64.length > 1
    ? `Extract the studio workout board from these ${imagesBase64.length} photos — they're photos of the same board (e.g. split across a wide whiteboard), so combine them into one coherent workout rather than treating each photo separately.`
    : "Extract the studio workout board from this photo of a whiteboard.";
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
        { role: "system", content: STUDIO_PARSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: withCorrection(instruction, correctionNote, previousResult) },
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

/** `correctionNote`, when given, re-parses the SAME source with the
 * trainee's own words about what the last read got wrong appended, anchored
 * to `previousResult` (that last read's own JSON) so the model corrects
 * rather than re-derives — used by studio-session's "reparse" action ("Did
 * I get something wrong?"). A plain re-parse (first read) omits both. */
export async function parseStudioWorkout(
  source: PlanSource,
  correctionNote?: string | null,
  previousResult?: ParsedStudioWorkout | null,
): Promise<ParsedStudioWorkout | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;

  let raw: string | null;
  if ("text" in source) {
    raw = await parseStudioFromText(source.text, correctionNote, previousResult);
  } else if ("pdfBase64" in source) {
    raw = await parseStudioPdf(source.pdfBase64, source.filename, correctionNote, previousResult);
  } else if ("imagesBase64" in source) {
    raw = await parseStudioImages(source.imagesBase64, correctionNote, previousResult);
  } else {
    const extracted = await textFromDocx(source.docxBase64);
    if (!extracted.trim()) return null;
    raw = await parseStudioFromText(extracted, correctionNote, previousResult);
  }
  if (!raw) return null;
  return normalizeFormats(normalizeMetrics(parsedStudioWorkoutSchema.parse(extractJson(raw))));
}
