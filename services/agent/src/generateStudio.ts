import { ChatOpenRouter } from "@langchain/openrouter";
import { z } from "zod";
import { extractJson } from "./util.js";
import { appLanguageSchema, type AppLanguage } from "./generate.js";
import { costCents, type LlmUsage } from "./llm.js";
import {
  normalizeFormats, normalizeMetrics, parsedStudioWorkoutSchema, type ParsedStudioWorkout,
} from "./parseStudio.js";

/**
 * AI-generated studio workouts — the class-workout sibling of generate.ts's
 * gym plan generation. Same shape discipline: a short structured intake,
 * one generation call, output reusing `parsedStudioWorkoutSchema` so a
 * generated workout is byte-for-byte the same shape a parsed board is and
 * commits through the exact same studio-session `open` write path (see
 * that function's new `generate` branch).
 *
 * Deliberately a workflow, not an agent: one fixed intake, one generation
 * call, no back-and-forth — same reasoning generate.ts's own doc comment
 * gives for gym plans.
 */

export const EQUIPMENT_OPTIONS = [
  "bodyweight", "dumbbells", "kettlebell", "barbell", "box",
  "jump_rope", "erg_bike_row", "wall_ball", "pull_up_bar",
] as const;
export type StudioEquipment = (typeof EQUIPMENT_OPTIONS)[number];

export const generateStudioInputSchema = z.object({
  fitnessLevel: z.enum(["beginner", "intermediate", "advanced"]),
  durationMin: z.number().int().min(10).max(60),
  equipment: z.array(z.enum(EQUIPMENT_OPTIONS)).min(1).max(EQUIPMENT_OPTIONS.length),
  focus: z.enum(["conditioning", "strength", "mixed"]),
  injuryNotes: z.string().max(500).nullable().default(null),
  // The app's currently selected UI language — workout/movement names must
  // be generated IN this language. Defaults to 'en' only for callers that
  // predate this field; the client always sends its actual current one.
  language: appLanguageSchema.default("en"),
  // Set only on a re-generation ("Did I get something wrong?" — see
  // studio-session's reparse branch for a `generate`-sourced session).
  // There's no original board to re-send here, so this rides along as an
  // extra constraint on a fresh generation instead.
  correctionNote: z.string().max(500).nullable().default(null),
});
export type GenerateStudioInput = z.infer<typeof generateStudioInputSchema>;

export interface GenerateStudioResult {
  workout: ParsedStudioWorkout;
  usage: LlmUsage;
}

const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English",
  he: "Hebrew",
  ar: "Arabic (Modern Standard Arabic)",
};

const LEVEL_LABELS: Record<GenerateStudioInput["fitnessLevel"], string> = {
  beginner: "beginner (new to class-style training — keep tiers, loads, and volume conservative)",
  intermediate: "intermediate (comfortable with the movements — moderate tiers, loads, and volume)",
  advanced: "advanced (experienced — the tiers you offer can sit meaningfully higher, higher volume is fine)",
};

const FOCUS_LABELS: Record<GenerateStudioInput["focus"], string> = {
  conditioning: "conditioning (higher heart rate, shorter loaded movements, machines/bodyweight-heavy)",
  strength: "strength (heavier loaded movements, lower reps per round, more rest built into the format)",
  mixed: "a mix of strength and conditioning across the blocks",
};

const EQUIPMENT_LABELS: Record<StudioEquipment, string> = {
  bodyweight: "bodyweight only",
  dumbbells: "dumbbells",
  kettlebell: "kettlebell",
  barbell: "barbell",
  box: "a plyo box",
  jump_rope: "a jump rope",
  erg_bike_row: "an erg machine (bike, rower, or ski erg)",
  wall_ball: "a wall ball",
  pull_up_bar: "a pull-up bar",
};

function buildSystemPrompt(language: AppLanguage): string {
  const languageName = LANGUAGE_NAMES[language];
  return [
    "You design functional-fitness / CrossFit-style / HIIT class workouts from a short structured intake. Reply with ONLY valid JSON matching:",
    '{"name":string,"scoreType":"fortime"|"amrap"|"emom"|"strength"|null,"blocks":[{"name":string|null,"formatType":"buyin"|"rounds"|"fortime"|"amrap"|"emom"|"intervals"|"custom"|null,"formatParams":{...},"formatCustom":string|null,"exercises":[{"name":string,"parseConfidence":null,"metrics":[{"unit":string,"value":number,"tiers":number[]|null,"tierIndex":number|null,"perSide":boolean,"ladder":number[]|null}]}]}]}. formatParams keys by formatType: buyin/fortime/custom/null -> {} (omit entirely), rounds -> {"count":number}, amrap -> {"cap":number} (minutes), emom -> {"every":number,"total":number} (both minutes), intervals -> {"on":number,"off":number} (both seconds). formatCustom is only used (a short literal label) when formatType is "custom". "parseConfidence" is ALWAYS null here — that field only ever flags an uncertain OCR read of someone else\'s handwriting, and you are never uncertain about your own design.',
    "",
    "Non-negotiable rules:",
    `- Every workout name, block name, exercise name, and formatCustom text MUST be written in ${languageName} — this is not optional and does not follow the intake's own field labels (those stay in English internally).`,
    "- \"name\" is a short, punchy class-style title (e.g. \"Strike Off\", \"Engine Room\") — never a generic placeholder like \"Workout\" or \"Class 1\".",
    "- BLOCKS: design 1-4 blocks that together fill roughly the requested duration. A single AMRAP/EMOM/for-time piece with 3-5 movements is a complete, legitimate one-block workout — don't pad it with blocks it doesn't need. Reach for more than one block (e.g. a buy-in, a main piece, a buy-out; or numbered stations) only when the requested duration and focus genuinely call for that much structure. Name a block ONLY when it's a genuine rotation trainees physically move between, using literally \"Station 1\", \"Station 2\", etc — an ordinary sequential block keeps \"name\": null.",
    "- FORMAT: give nearly every block a real formatType sized so its own duration roughly matches its share of the total requested duration — this is a designed workout, not a free-for-all list. formatType is null only for the rare block that's genuinely just a checklist with no clock on it.",
    "- SCALING TIERS: for a handful of the workout's harder movements (never all of them), offer three ascending scaling levels matched to the given fitness level — \"tiers\": [low,mid,high] (3 ascending numbers), \"tierIndex\" the middle index (1), \"value\" equal to tiers[1]. A beginner's whole tier set should sit lower across the board than an advanced trainee's, not just the starting point.",
    "- PER-SIDE: for a unilateral movement (pistol squat, any lunge variant, single-arm row, split squat, Bulgarian split squat, step-up, single-leg RDL, gorilla row, side plank, single-leg glute bridge, and similar one-limb-at-a-time movements), set \"perSide\": true with a single \"value\" — never tiers, never two separate numbers.",
    "- LADDER: for AT MOST ONE benchmark-style movement in the whole workout, you may use a descending rep ladder (3-5 values, e.g. [21,15,9]) instead of tiers — set \"ladder\" to that array, \"value\" to ladder[0], and that block's formatType to \"rounds\" with formatParams.count equal to the ladder's own length (they must agree). Most workouts have none.",
    "- A plain movement with one clear, ungraded number needs tiers/perSide/ladder all left null/false — not every exercise needs scaling.",
    "- UNITS: \"cals\" or \"m\" for an erg/bike/row/ski piece (pick whichever the piece is actually programmed in), \"lengths\" for a loaded carry, \"kg\" for any other loaded movement, \"reps\" for bodyweight movements. Keep any \"kg\" value conservative and safe for the given fitness level — never a maximal or risky number.",
    "- EQUIPMENT: use ONLY movements possible with the given equipment list, plus bodyweight (always available in addition to whatever's listed). Never invent a movement that needs equipment not in that list.",
    "- You are a fitness coaching assistant, not a medical professional. Never diagnose. If injury notes suggest something serious, still design a safe, sensible workout — just avoid movements/patterns that would plausibly aggravate the stated issue.",
    "- \"scoreType\" (top-level): set it ONLY when the entire workout is genuinely one for-time/AMRAP/EMOM piece, or a benchmark strength lift (\"strength\") with one overall number to record. Leave it null for a workout built from buy-in/buy-out, fixed-round, or interval blocks, where the per-exercise values already captured under each block ARE the result.",
  ].join("\n");
}

function buildHumanPrompt(input: GenerateStudioInput): string {
  const equipmentList = input.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ");
  const lines = [
    `Fitness level: ${LEVEL_LABELS[input.fitnessLevel]}`,
    `Target duration: about ${input.durationMin} minutes total`,
    `Available equipment: ${equipmentList} (plus bodyweight, always available)`,
    `Focus: ${FOCUS_LABELS[input.focus]}`,
    `Injury notes: ${input.injuryNotes ?? "none"}.`,
    `Target language for every name and text field: ${LANGUAGE_NAMES[input.language]}.`,
  ];
  if (input.correctionNote?.trim()) {
    lines.push(
      "",
      `A trainee already reviewed a previous workout generated for these exact same constraints and said this about what they'd like changed: "${input.correctionNote.trim()}". Design a new workout that takes that feedback into account.`,
    );
  }
  return lines.join("\n");
}

/**
 * One real few-shot example per supported language (generate.ts's own
 * "examples beat prose" lesson, reapplied here) — the SAME workout,
 * translated, not just a prose instruction to "use language X".
 */
const FEW_SHOT: Record<AppLanguage, { input: string; output: string }> = {
  en: {
    input: `Fitness level: intermediate (comfortable with the movements — moderate tiers, loads, and volume)
Target duration: about 20 minutes total
Available equipment: dumbbells, a jump rope (plus bodyweight, always available)
Focus: conditioning (higher heart rate, shorter loaded movements, machines/bodyweight-heavy)
Injury notes: none.
Target language for every name and text field: English.`,
    output: JSON.stringify({
      name: "Rope & Row",
      scoreType: "amrap",
      blocks: [
        {
          name: null,
          formatType: "amrap",
          formatParams: { cap: 20 },
          formatCustom: null,
          exercises: [
            {
              name: "Jump Rope", parseConfidence: null,
              metrics: [{ unit: "reps", value: 50, tiers: [30, 50, 70], tierIndex: 1, perSide: false, ladder: null }],
            },
            {
              name: "Dumbbell Thrusters", parseConfidence: null,
              metrics: [{ unit: "reps", value: 12, tiers: [8, 12, 16], tierIndex: 1, perSide: false, ladder: null }],
            },
            {
              name: "Walking Lunges", parseConfidence: null,
              metrics: [{ unit: "reps", value: 10, tiers: null, tierIndex: null, perSide: true, ladder: null }],
            },
            {
              name: "Burpees", parseConfidence: null,
              metrics: [{ unit: "reps", value: 10, tiers: [6, 10, 14], tierIndex: 1, perSide: false, ladder: null }],
            },
          ],
        },
      ],
    }),
  },
  he: {
    input: `Fitness level: intermediate (comfortable with the movements — moderate tiers, loads, and volume)
Target duration: about 20 minutes total
Available equipment: dumbbells, a jump rope (plus bodyweight, always available)
Focus: conditioning (higher heart rate, shorter loaded movements, machines/bodyweight-heavy)
Injury notes: none.
Target language for every name and text field: Hebrew.`,
    output: JSON.stringify({
      name: "חבל ומשקולות",
      scoreType: "amrap",
      blocks: [
        {
          name: null,
          formatType: "amrap",
          formatParams: { cap: 20 },
          formatCustom: null,
          exercises: [
            {
              name: "קפיצות חבל", parseConfidence: null,
              metrics: [{ unit: "reps", value: 50, tiers: [30, 50, 70], tierIndex: 1, perSide: false, ladder: null }],
            },
            {
              name: "תראסטרים עם משקולות", parseConfidence: null,
              metrics: [{ unit: "reps", value: 12, tiers: [8, 12, 16], tierIndex: 1, perSide: false, ladder: null }],
            },
            {
              name: "לאנג'ים בהליכה", parseConfidence: null,
              metrics: [{ unit: "reps", value: 10, tiers: null, tierIndex: null, perSide: true, ladder: null }],
            },
            {
              name: "בורפיז", parseConfidence: null,
              metrics: [{ unit: "reps", value: 10, tiers: [6, 10, 14], tierIndex: 1, perSide: false, ladder: null }],
            },
          ],
        },
      ],
    }),
  },
  ar: {
    input: `Fitness level: intermediate (comfortable with the movements — moderate tiers, loads, and volume)
Target duration: about 20 minutes total
Available equipment: dumbbells, a jump rope (plus bodyweight, always available)
Focus: conditioning (higher heart rate, shorter loaded movements, machines/bodyweight-heavy)
Injury notes: none.
Target language for every name and text field: Arabic.`,
    output: JSON.stringify({
      name: "حبل ودمبل",
      scoreType: "amrap",
      blocks: [
        {
          name: null,
          formatType: "amrap",
          formatParams: { cap: 20 },
          formatCustom: null,
          exercises: [
            {
              name: "نط الحبل", parseConfidence: null,
              metrics: [{ unit: "reps", value: 50, tiers: [30, 50, 70], tierIndex: 1, perSide: false, ladder: null }],
            },
            {
              name: "ثراستر بالدمبل", parseConfidence: null,
              metrics: [{ unit: "reps", value: 12, tiers: [8, 12, 16], tierIndex: 1, perSide: false, ladder: null }],
            },
            {
              name: "لنجز أثناء المشي", parseConfidence: null,
              metrics: [{ unit: "reps", value: 10, tiers: null, tierIndex: null, perSide: true, ladder: null }],
            },
            {
              name: "بيربيز", parseConfidence: null,
              metrics: [{ unit: "reps", value: 10, tiers: [6, 10, 14], tierIndex: 1, perSide: false, ladder: null }],
            },
          ],
        },
      ],
    }),
  },
};

function generateModel(): ChatOpenRouter | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return new ChatOpenRouter({
    model: "google/gemini-3.1-flash-lite",
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens: 2048, // a 1-4 block class workout, comfortably smaller than a multi-plan gym program
    temperature: 0.4, // a little more creative than parse's 0 — workout design benefits from variety
    siteName: "Notch",
  });
}

export async function generateStudioWorkout(
  input: GenerateStudioInput,
): Promise<GenerateStudioResult | null> {
  const model = generateModel();
  if (!model) return null;

  const fewShot = FEW_SHOT[input.language];
  const res = await model.invoke([
    ["system", buildSystemPrompt(input.language)],
    ["human", fewShot.input],
    ["ai", fewShot.output],
    ["human", buildHumanPrompt(input)],
  ]);

  const tokensInput = res.usage_metadata?.input_tokens ?? 0;
  const tokensOutput = res.usage_metadata?.output_tokens ?? 0;
  const usage: LlmUsage = { tokensInput, tokensOutput, costCents: costCents(tokensInput, tokensOutput) };

  const raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  const workout = normalizeFormats(normalizeMetrics(parsedStudioWorkoutSchema.parse(extractJson(raw))));

  return { workout, usage };
}
