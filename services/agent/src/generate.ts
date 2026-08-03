import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import { extractJson } from "./util.js";
import { equipmentTypeSchema } from "./schema.js";
import { parsedPlanSchema, type ParsedPlan } from "./parse.js";
import { costCents, type LlmUsage } from "./llm.js";

/**
 * AI-generated training plans (System Design §21): a user with no plan yet
 * answers a short structured intake (goal / experience / days-per-week,
 * optionally gender/age/weight/height/injuries), and this turns that into a
 * real plan — reusing `parsedPlanSchema` as the output shape so it commits
 * through the exact same `plan-import` path a pasted plan does.
 *
 * Deliberately a workflow, not an agent (§21): one fixed intake, one
 * generation call, no back-and-forth — there's nothing here for a
 * tool-calling loop to earn its cost on.
 */

export const generatePlanInputSchema = z.object({
  primaryGoal: z.enum(["strength", "hypertrophy", "general_fitness", "fat_loss"]),
  experienceLevel: z.enum(["beginner", "intermediate", "advanced"]),
  daysPerWeek: z.number().int().min(2).max(6),
  gender: z.enum(["male", "female", "other"]).nullable().default(null),
  age: z.number().int().min(10).max(100).nullable().default(null),
  weightKg: z.number().min(20).max(400).nullable().default(null),
  heightCm: z.number().min(100).max(250).nullable().default(null),
  injuryNotes: z.string().max(500).nullable().default(null),
});
export type GeneratePlanInput = z.infer<typeof generatePlanInputSchema>;

const commonExerciseSchema = z.object({
  name: z.string(),
  muscleGroup: z.string(),
  movementPattern: z.enum(["push", "pull", "squat", "hinge", "lunge", "core", "isolation"]),
  equipmentType: equipmentTypeSchema,
  isCompound: z.boolean(),
});
export type CommonExercise = z.infer<typeof commonExerciseSchema>;

export interface GeneratePlanResult {
  plans: ParsedPlan["plans"];
  linterChecks: LinterCheck[];
  usage: LlmUsage;
}

const GOAL_LABELS: Record<GeneratePlanInput["primaryGoal"], string> = {
  strength: "strength (lower reps, heavier relative loading)",
  hypertrophy: "muscle growth / hypertrophy (moderate reps, higher volume)",
  general_fitness: "general fitness (higher reps, some conditioning flavor)",
  fat_loss: "fat loss (higher reps, shorter rest, some conditioning flavor)",
};

const GOAL_VOLUME_RULES: Record<GeneratePlanInput["primaryGoal"], string> = {
  strength: "Compound lifts: 3-6 reps, 3-5 sets, rest 120-180s. Isolation: 6-10 reps, 2-3 sets, rest 60-90s.",
  hypertrophy: "Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.",
  general_fitness: "10-15 reps across the board, 2-3 sets, rest 45-75s. Include some bodyweight/core work.",
  fat_loss: "10-15 reps across the board, 3 sets, rest 30-60s. Include some bodyweight/core work.",
};

/** Plan-entry count and split, driven by days/week — not a 1:1 day mapping (§21). */
function splitFor(daysPerWeek: number): { splitName: string; planCount: number; planLabel: string } {
  if (daysPerWeek <= 3) {
    return { splitName: "full body", planCount: 2, planLabel: '2 plans named "אימון גוף מלא A" and "אימון גoף מלא B" (vary exercise selection between them, both still full-body)' };
  }
  if (daysPerWeek === 4) {
    return { splitName: "upper/lower", planCount: 2, planLabel: '2 plans named "אימון פלג גוף עליון" (upper) and "אימון פלג גוף תחתון" (lower)' };
  }
  return { splitName: "push/pull/legs", planCount: 3, planLabel: '3 plans named "אימון דחיפה" (push), "אימון משיכה" (pull), "אימון רגליים" (legs)' };
}

const FEW_SHOT_INPUT = `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "אימון פלג גוף עליון" (upper) and "אימון פלג גוף תחתון" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.`;

const FEW_SHOT_OUTPUT = JSON.stringify({
  plans: [
    {
      name: "אימון פלג גוף עליון",
      exercises: [
        { orderIndex: 1, name: "לחיצת חזה עם מוט", sets: 4, repRange: "6-10", restSec: 120, intensity: "RPE 7-8", warmup: "2 סטי חימום קלים לפני הסט הראשון", equipmentType: "barbell" },
        { orderIndex: 2, name: "משיכת פולי עליון", sets: 4, repRange: "8-10", restSec: 90, intensity: "RPE 7-8", warmup: null, equipmentType: "cable" },
        { orderIndex: 3, name: "לחיצת כתפיים עם משקולות", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
        { orderIndex: 4, name: "חתירה עם משקולת חד-יד", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
        { orderIndex: 5, name: "כפיפת מרפקים עם משקולות", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
        { orderIndex: 6, name: "פשיטת מרפקים בפולי", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "cable" },
      ],
    },
    {
      name: "אימון פלג גוף תחתון",
      exercises: [
        { orderIndex: 1, name: "סקוואט עם מוט", sets: 4, repRange: "6-10", restSec: 150, intensity: "RPE 7-8", warmup: "2-3 סטי חימום עולים לפני הסט הראשון", equipmentType: "barbell" },
        { orderIndex: 2, name: "דדליפט רומני עם מוט", sets: 3, repRange: "8-10", restSec: 120, intensity: "RPE 7-8", warmup: null, equipmentType: "barbell" },
        { orderIndex: 3, name: "לחיצת רגליים", sets: 3, repRange: "10-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
        { orderIndex: 4, name: "כפיפת ברכיים במכונה", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
        { orderIndex: 5, name: "עמידה על קצות אצבעות בעמידה", sets: 3, repRange: "12-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
        { orderIndex: 6, name: "פלאנק", sets: 3, repRange: "30-45 שניות", restSec: 45, intensity: "עד כמעט כשל", warmup: null, equipmentType: "bodyweight" },
      ],
    },
  ],
});

function buildSystemPrompt(): string {
  return [
    "You design gym training programs from a short structured intake. Reply with ONLY valid JSON matching:",
    '{"plans":[{"name":string,"exercises":[{"orderIndex":number,"name":string,"sets":number,"repRange":string,"restSec":number,"intensity":string,"warmup":string|null,"equipmentType":"barbell"|"dumbbell"|"machine"|"cable"|"bodyweight"|"other"}]}]}',
    "",
    "Non-negotiable rules:",
    "- You are a fitness coaching assistant, not a medical professional. Never diagnose. If injury notes suggest something serious, still design a safe, sensible plan — just avoid exercises/movement patterns that would plausibly aggravate the stated issue.",
    "- Never invent a precise numeric starting weight — there is no lift history yet for this user. `intensity` is always qualitative (e.g. \"RPE 7\", \"עד כמעט כשל\"), never a kg number. Gender/age/weight/height, when given, only nudge exercise selection and volume tone — they are never inputs to a computed number.",
    "- `warmup` is null for almost every exercise. Only the FIRST heavy compound, cold-start movement of each plan (typically a squat/hinge/press-pattern barbell or heavy dumbbell lift) gets a short warmup note (e.g. \"2-3 סטי חימום עולים לפני הסט הראשון\") — isolation and machine work never needs one, the muscle is already warm.",
    "- Exercise names in Hebrew, matching common real gym exercise names (not invented or obscure ones). Prefer machines and dumbbells over technically demanding barbell lifts for beginners.",
    "- `repRange` as a short string (e.g. \"6-10\", \"30-45 שניות\" for a timed hold). `restSec` in seconds. `orderIndex` starts at 1 per plan.",
    "- Exactly the number of plans specified below, each a genuinely different session (not near-duplicates of each other), 5-7 exercises per plan.",
  ].join("\n");
}

function buildHumanPrompt(input: GeneratePlanInput): string {
  const { splitName, planCount, planLabel } = splitFor(input.daysPerWeek);
  const lines = [
    `Goal: ${GOAL_LABELS[input.primaryGoal]}`,
    `Experience level: ${input.experienceLevel}`,
    `Days per week: ${input.daysPerWeek} -> split: ${splitName}, ${planCount} plans -> ${planLabel}`,
    `Volume rule: ${GOAL_VOLUME_RULES[input.primaryGoal]}`,
    `Gender: ${input.gender ?? "not given"}. Age: ${input.age ?? "not given"}. Weight: ${input.weightKg ?? "not given"}kg. Height: ${input.heightCm ?? "not given"}cm.`,
    `Injury notes: ${input.injuryNotes ?? "none"}.`,
  ];
  return lines.join("\n");
}

function generateModel(): ChatGoogleGenerativeAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  return new ChatGoogleGenerativeAI({
    model: "gemini-3.1-flash-lite",
    apiKey: process.env.GEMINI_API_KEY,
    maxOutputTokens: 3072, // a 2-3 plan program, comparable to parse.ts's 4096 cap for parsing up to 10
    temperature: 0.3, // low but non-zero: follow the decision rules closely, allow some exercise-selection variety
  });
}

export async function generateWorkoutPlan(
  input: GeneratePlanInput,
  commonExercises: CommonExercise[],
): Promise<GeneratePlanResult | null> {
  const model = generateModel();
  if (!model) return null;

  const res = await model.invoke([
    ["system", buildSystemPrompt()],
    ["human", FEW_SHOT_INPUT],
    ["ai", FEW_SHOT_OUTPUT],
    ["human", buildHumanPrompt(input)],
  ]);

  const tokensInput = res.usage_metadata?.input_tokens ?? 0;
  const tokensOutput = res.usage_metadata?.output_tokens ?? 0;
  const usage: LlmUsage = { tokensInput, tokensOutput, costCents: costCents(tokensInput, tokensOutput) };

  const raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  const parsed = parsedPlanSchema.parse(extractJson(raw));

  return {
    plans: parsed.plans,
    linterChecks: lintPlan(parsed.plans, commonExercises),
    usage,
  };
}

export interface LinterCheck {
  pattern: "push" | "pull" | "squat" | "hinge";
  covered: boolean;
  exampleExercise: string | null;
}

const CHECKED_PATTERNS: LinterCheck["pattern"][] = ["push", "pull", "squat", "hinge"];

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Deterministic sanity check (§21 "Plan quality"), NOT an LLM judgment call:
 * matches each generated exercise name against the common_exercises seed
 * list (exact or substring match) to get a real movement-pattern tag, then
 * checks whether the whole program (across all plans, since a single-day
 * split legitimately won't cover every pattern on its own) touches each of
 * the load-bearing patterns at least once. Non-blocking by design — this
 * only informs a soft warning on the preview screen, never rejects a plan.
 */
export function lintPlan(plans: ParsedPlan["plans"], commonExercises: CommonExercise[]): LinterCheck[] {
  const allExerciseNames = plans.flatMap((p) => p.exercises.map((e) => e.name));

  return CHECKED_PATTERNS.map((pattern) => {
    for (const exerciseName of allExerciseNames) {
      const n = normalize(exerciseName);
      const match = commonExercises.find((c) => {
        const cn = normalize(c.name);
        return c.movementPattern === pattern && (n === cn || n.includes(cn) || cn.includes(n));
      });
      if (match) return { pattern, covered: true, exampleExercise: exerciseName };
    }
    return { pattern, covered: false, exampleExercise: null };
  });
}
