import { ChatOpenRouter } from "@langchain/openrouter";
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

export const appLanguageSchema = z.enum(["en", "he", "ar", "es", "de", "pt", "fr", "it"]);
export type AppLanguage = z.infer<typeof appLanguageSchema>;

export const generatePlanInputSchema = z.object({
  primaryGoal: z.enum(["strength", "hypertrophy", "general_fitness", "fat_loss"]),
  experienceLevel: z.enum(["beginner", "intermediate", "advanced"]),
  daysPerWeek: z.number().int().min(1).max(6),
  gender: z.enum(["male", "female", "other"]).nullable().default(null),
  age: z.number().int().min(10).max(100).nullable().default(null),
  weightKg: z.number().min(20).max(400).nullable().default(null),
  heightCm: z.number().min(100).max(250).nullable().default(null),
  injuryNotes: z.string().max(500).nullable().default(null),
  // The app's currently selected UI language (System Design's language
  // support) — plan/exercise names must be generated IN this language,
  // not a fixed one. Defaults to 'en' only for callers that predate this
  // field; the client always sends its actual current language explicitly.
  language: appLanguageSchema.default("en"),
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

const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English",
  he: "Hebrew",
  ar: "Arabic (Modern Standard Arabic)",
  es: "Spanish",
  de: "German",
  pt: "Portuguese (Brazilian)",
  fr: "French",
  it: "Italian",
};

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

/** Plan-name templates per split per language — the model copies these verbatim, not translated on the fly. */
const SPLIT_NAMES: Record<AppLanguage, { fullBody: [string, string]; upperLower: [string, string]; ppl: [string, string, string] }> = {
  en: {
    fullBody: ["Full Body Workout A", "Full Body Workout B"],
    upperLower: ["Upper Body Workout", "Lower Body Workout"],
    ppl: ["Push Day", "Pull Day", "Leg Day"],
  },
  he: {
    fullBody: ["אימון גוף מלא A", "אימון גוף מלא B"],
    upperLower: ["אימון פלג גוף עליון", "אימון פלג גוף תחתון"],
    ppl: ["אימון דחיפה", "אימון משיכה", "אימון רגליים"],
  },
  ar: {
    fullBody: ["تمرين كامل الجسم A", "تمرين كامل الجسم B"],
    upperLower: ["تمرين الجزء العلوي", "تمرين الجزء السفلي"],
    ppl: ["يوم الدفع", "يوم السحب", "يوم الأرجل"],
  },
  es: {
    fullBody: ["Entrenamiento de Cuerpo Completo A", "Entrenamiento de Cuerpo Completo B"],
    upperLower: ["Entrenamiento de Tren Superior", "Entrenamiento de Tren Inferior"],
    ppl: ["Día de Empuje", "Día de Tracción", "Día de Piernas"],
  },
  de: {
    fullBody: ["Ganzkörpertraining A", "Ganzkörpertraining B"],
    upperLower: ["Oberkörper-Training", "Unterkörper-Training"],
    ppl: ["Push-Tag", "Pull-Tag", "Beintag"],
  },
  pt: {
    fullBody: ["Treino de Corpo Inteiro A", "Treino de Corpo Inteiro B"],
    upperLower: ["Treino de Membros Superiores", "Treino de Membros Inferiores"],
    ppl: ["Dia de Empurrar", "Dia de Puxar", "Dia de Pernas"],
  },
  fr: {
    fullBody: ["Entraînement Corps Complet A", "Entraînement Corps Complet B"],
    upperLower: ["Entraînement Haut du Corps", "Entraînement Bas du Corps"],
    ppl: ["Jour Poussée", "Jour Tirage", "Jour Jambes"],
  },
  it: {
    fullBody: ["Allenamento Total Body A", "Allenamento Total Body B"],
    upperLower: ["Allenamento Parte Superiore", "Allenamento Parte Inferiore"],
    ppl: ["Giorno Spinta", "Giorno Trazione", "Giorno Gambe"],
  },
};

/** Plan-entry count and split, driven by days/week — not a 1:1 day mapping (§21). */
function splitFor(daysPerWeek: number, language: AppLanguage): { splitName: string; planCount: number; planLabel: string } {
  const names = SPLIT_NAMES[language];
  if (daysPerWeek <= 3) {
    return { splitName: "full body", planCount: 2, planLabel: `2 plans named "${names.fullBody[0]}" and "${names.fullBody[1]}" (vary exercise selection between them, both still full-body)` };
  }
  if (daysPerWeek === 4) {
    return { splitName: "upper/lower", planCount: 2, planLabel: `2 plans named "${names.upperLower[0]}" (upper) and "${names.upperLower[1]}" (lower)` };
  }
  return { splitName: "push/pull/legs", planCount: 3, planLabel: `3 plans named "${names.ppl[0]}" (push), "${names.ppl[1]}" (pull), "${names.ppl[2]}" (legs)` };
}

/**
 * One real few-shot example per supported language (§18's "examples beat
 * prose" lesson, reapplied): the SAME 4-day upper/lower hypertrophy program,
 * translated, not just a prose instruction to "use language X" — a Hebrew
 * example was found to leak Hebrew exercise names into English output even
 * when the system prompt explicitly said English, so the example itself has
 * to match the target language, not just describe it.
 */
const FEW_SHOT: Record<AppLanguage, { input: string; output: string }> = {
  en: {
    input: `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "Upper Body Workout" (upper) and "Lower Body Workout" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.
Target language for every name and text field: English.`,
    output: JSON.stringify({
      plans: [
        {
          name: "Upper Body Workout",
          exercises: [
            { orderIndex: 1, name: "Barbell Bench Press", sets: 4, repRange: "6-10", restSec: 120, intensity: "RPE 7-8", warmup: "2 light warm-up sets before the first work set", equipmentType: "barbell" },
            { orderIndex: 2, name: "Lat Pulldown", sets: 4, repRange: "8-10", restSec: 90, intensity: "RPE 7-8", warmup: null, equipmentType: "cable" },
            { orderIndex: 3, name: "Dumbbell Shoulder Press", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 4, name: "Single-Arm Dumbbell Row", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 5, name: "Dumbbell Bicep Curl", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 6, name: "Cable Tricep Pushdown", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "cable" },
          ],
        },
        {
          name: "Lower Body Workout",
          exercises: [
            { orderIndex: 1, name: "Barbell Squat", sets: 4, repRange: "6-10", restSec: 150, intensity: "RPE 7-8", warmup: "2-3 ascending warm-up sets before the first work set", equipmentType: "barbell" },
            { orderIndex: 2, name: "Barbell Romanian Deadlift", sets: 3, repRange: "8-10", restSec: 120, intensity: "RPE 7-8", warmup: null, equipmentType: "barbell" },
            { orderIndex: 3, name: "Leg Press", sets: 3, repRange: "10-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 4, name: "Leg Curl Machine", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 5, name: "Standing Calf Raise", sets: 3, repRange: "12-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 6, name: "Plank", sets: 3, repRange: "30-45 sec", restSec: 45, intensity: "near failure", warmup: null, equipmentType: "bodyweight" },
          ],
        },
      ],
    }),
  },
  he: {
    input: `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "אימון פלג גוף עליון" (upper) and "אימון פלג גוף תחתון" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.
Target language for every name and text field: Hebrew.`,
    output: JSON.stringify({
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
    }),
  },
  ar: {
    input: `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "تمرين الجزء العلوي" (upper) and "تمرين الجزء السفلي" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.
Target language for every name and text field: Arabic.`,
    output: JSON.stringify({
      plans: [
        {
          name: "تمرين الجزء العلوي",
          exercises: [
            { orderIndex: 1, name: "ضغط بنش بار", sets: 4, repRange: "6-10", restSec: 120, intensity: "RPE 7-8", warmup: "مجموعتا إحماء خفيفتان قبل المجموعة الأولى", equipmentType: "barbell" },
            { orderIndex: 2, name: "سحب علوي بالكابل", sets: 4, repRange: "8-10", restSec: 90, intensity: "RPE 7-8", warmup: null, equipmentType: "cable" },
            { orderIndex: 3, name: "ضغط أكتاف بالدمبل", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 4, name: "تجديف بالدمبل بيد واحدة", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 5, name: "تمرين البايسبس بالدمبل", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 6, name: "سحب ترايسبس بالكابل", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "cable" },
          ],
        },
        {
          name: "تمرين الجزء السفلي",
          exercises: [
            { orderIndex: 1, name: "سكوات بار", sets: 4, repRange: "6-10", restSec: 150, intensity: "RPE 7-8", warmup: "2-3 مجموعات إحماء تصاعدية قبل المجموعة الأولى", equipmentType: "barbell" },
            { orderIndex: 2, name: "ديدليفت روماني بار", sets: 3, repRange: "8-10", restSec: 120, intensity: "RPE 7-8", warmup: null, equipmentType: "barbell" },
            { orderIndex: 3, name: "ضغط أرجل", sets: 3, repRange: "10-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 4, name: "تمرين خلف الفخذ بالجهاز", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 5, name: "رفع سمانة وقوف", sets: 3, repRange: "12-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 6, name: "بلانك", sets: 3, repRange: "30-45 ثانية", restSec: 45, intensity: "قريب من الفشل", warmup: null, equipmentType: "bodyweight" },
          ],
        },
      ],
    }),
  },
  es: {
    input: `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "Entrenamiento de Tren Superior" (upper) and "Entrenamiento de Tren Inferior" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.
Target language for every name and text field: Spanish.`,
    output: JSON.stringify({
      plans: [
        {
          name: "Entrenamiento de Tren Superior",
          exercises: [
            { orderIndex: 1, name: "Press de Banca con Barra", sets: 4, repRange: "6-10", restSec: 120, intensity: "RPE 7-8", warmup: "2 series de calentamiento ligeras antes de la primera serie de trabajo", equipmentType: "barbell" },
            { orderIndex: 2, name: "Jalón al Pecho", sets: 4, repRange: "8-10", restSec: 90, intensity: "RPE 7-8", warmup: null, equipmentType: "cable" },
            { orderIndex: 3, name: "Press de Hombros con Mancuernas", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 4, name: "Remo con Mancuerna a Una Mano", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 5, name: "Curl de Bíceps con Mancuernas", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 6, name: "Extensión de Tríceps en Polea", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "cable" },
          ],
        },
        {
          name: "Entrenamiento de Tren Inferior",
          exercises: [
            { orderIndex: 1, name: "Sentadilla con Barra", sets: 4, repRange: "6-10", restSec: 150, intensity: "RPE 7-8", warmup: "2-3 series de calentamiento ascendentes antes de la primera serie de trabajo", equipmentType: "barbell" },
            { orderIndex: 2, name: "Peso Muerto Rumano con Barra", sets: 3, repRange: "8-10", restSec: 120, intensity: "RPE 7-8", warmup: null, equipmentType: "barbell" },
            { orderIndex: 3, name: "Prensa de Piernas", sets: 3, repRange: "10-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 4, name: "Máquina de Curl Femoral", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 5, name: "Elevación de Talones de Pie", sets: 3, repRange: "12-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 6, name: "Plancha", sets: 3, repRange: "30-45 seg", restSec: 45, intensity: "cerca del fallo", warmup: null, equipmentType: "bodyweight" },
          ],
        },
      ],
    }),
  },
  de: {
    input: `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "Oberkörper-Training" (upper) and "Unterkörper-Training" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.
Target language for every name and text field: German.`,
    output: JSON.stringify({
      plans: [
        {
          name: "Oberkörper-Training",
          exercises: [
            { orderIndex: 1, name: "Bankdrücken mit Langhantel", sets: 4, repRange: "6-10", restSec: 120, intensity: "RPE 7-8", warmup: "2 leichte Aufwärmsätze vor dem ersten Arbeitssatz", equipmentType: "barbell" },
            { orderIndex: 2, name: "Latzug", sets: 4, repRange: "8-10", restSec: 90, intensity: "RPE 7-8", warmup: null, equipmentType: "cable" },
            { orderIndex: 3, name: "Schulterdrücken mit Kurzhanteln", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 4, name: "Einarmiges Kurzhantelrudern", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 5, name: "Bizepscurls mit Kurzhanteln", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 6, name: "Trizeps-Pushdown am Kabel", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "cable" },
          ],
        },
        {
          name: "Unterkörper-Training",
          exercises: [
            { orderIndex: 1, name: "Kniebeuge mit Langhantel", sets: 4, repRange: "6-10", restSec: 150, intensity: "RPE 7-8", warmup: "2-3 aufsteigende Aufwärmsätze vor dem ersten Arbeitssatz", equipmentType: "barbell" },
            { orderIndex: 2, name: "Rumänisches Kreuzheben mit Langhantel", sets: 3, repRange: "8-10", restSec: 120, intensity: "RPE 7-8", warmup: null, equipmentType: "barbell" },
            { orderIndex: 3, name: "Beinpresse", sets: 3, repRange: "10-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 4, name: "Beinbeuger-Maschine", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 5, name: "Wadenheben im Stehen", sets: 3, repRange: "12-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 6, name: "Plank", sets: 3, repRange: "30-45 Sek.", restSec: 45, intensity: "nahe am Muskelversagen", warmup: null, equipmentType: "bodyweight" },
          ],
        },
      ],
    }),
  },
  pt: {
    input: `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "Treino de Membros Superiores" (upper) and "Treino de Membros Inferiores" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.
Target language for every name and text field: Portuguese (Brazilian).`,
    output: JSON.stringify({
      plans: [
        {
          name: "Treino de Membros Superiores",
          exercises: [
            { orderIndex: 1, name: "Supino Reto com Barra", sets: 4, repRange: "6-10", restSec: 120, intensity: "RPE 7-8", warmup: "2 séries leves de aquecimento antes da primeira série de trabalho", equipmentType: "barbell" },
            { orderIndex: 2, name: "Puxada Frontal", sets: 4, repRange: "8-10", restSec: 90, intensity: "RPE 7-8", warmup: null, equipmentType: "cable" },
            { orderIndex: 3, name: "Desenvolvimento com Halteres", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 4, name: "Remada Unilateral com Halter", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 5, name: "Rosca Bíceps com Halteres", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 6, name: "Tríceps Corda na Polia", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "cable" },
          ],
        },
        {
          name: "Treino de Membros Inferiores",
          exercises: [
            { orderIndex: 1, name: "Agachamento Livre", sets: 4, repRange: "6-10", restSec: 150, intensity: "RPE 7-8", warmup: "2-3 séries de aquecimento crescentes antes da primeira série de trabalho", equipmentType: "barbell" },
            { orderIndex: 2, name: "Levantamento Terra Romeno com Barra", sets: 3, repRange: "8-10", restSec: 120, intensity: "RPE 7-8", warmup: null, equipmentType: "barbell" },
            { orderIndex: 3, name: "Leg Press", sets: 3, repRange: "10-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 4, name: "Mesa Flexora", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 5, name: "Elevação de Panturrilha em Pé", sets: 3, repRange: "12-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 6, name: "Prancha", sets: 3, repRange: "30-45 seg", restSec: 45, intensity: "próximo da falha", warmup: null, equipmentType: "bodyweight" },
          ],
        },
      ],
    }),
  },
  fr: {
    input: `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "Entraînement Haut du Corps" (upper) and "Entraînement Bas du Corps" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.
Target language for every name and text field: French.`,
    output: JSON.stringify({
      plans: [
        {
          name: "Entraînement Haut du Corps",
          exercises: [
            { orderIndex: 1, name: "Développé Couché à la Barre", sets: 4, repRange: "6-10", restSec: 120, intensity: "RPE 7-8", warmup: "2 séries légères d'échauffement avant la première série de travail", equipmentType: "barbell" },
            { orderIndex: 2, name: "Tirage Vertical", sets: 4, repRange: "8-10", restSec: 90, intensity: "RPE 7-8", warmup: null, equipmentType: "cable" },
            { orderIndex: 3, name: "Développé Épaules avec Haltères", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 4, name: "Rowing Unilatéral à l'Haltère", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 5, name: "Curl Biceps avec Haltères", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 6, name: "Extension Triceps à la Poulie", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "cable" },
          ],
        },
        {
          name: "Entraînement Bas du Corps",
          exercises: [
            { orderIndex: 1, name: "Squat à la Barre", sets: 4, repRange: "6-10", restSec: 150, intensity: "RPE 7-8", warmup: "2-3 séries d'échauffement croissantes avant la première série de travail", equipmentType: "barbell" },
            { orderIndex: 2, name: "Soulevé de Terre Roumain à la Barre", sets: 3, repRange: "8-10", restSec: 120, intensity: "RPE 7-8", warmup: null, equipmentType: "barbell" },
            { orderIndex: 3, name: "Presse à Cuisses", sets: 3, repRange: "10-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 4, name: "Leg Curl à la Machine", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 5, name: "Mollets Debout", sets: 3, repRange: "12-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 6, name: "Gainage", sets: 3, repRange: "30-45 sec", restSec: 45, intensity: "proche de l'échec", warmup: null, equipmentType: "bodyweight" },
          ],
        },
      ],
    }),
  },
  it: {
    input: `Goal: muscle growth / hypertrophy (moderate reps, higher volume)
Experience level: intermediate
Days per week: 4 -> split: upper/lower, 2 plans named "Allenamento Parte Superiore" (upper) and "Allenamento Parte Inferiore" (lower)
Volume rule: Compound lifts: 6-10 reps, 3-4 sets, rest 90-120s. Isolation: 8-15 reps, 3 sets, rest 60-90s.
Gender: not given. Age: not given. Weight: not given. Height: not given.
Injury notes: none.
Target language for every name and text field: Italian.`,
    output: JSON.stringify({
      plans: [
        {
          name: "Allenamento Parte Superiore",
          exercises: [
            { orderIndex: 1, name: "Panca Piana con Bilanciere", sets: 4, repRange: "6-10", restSec: 120, intensity: "RPE 7-8", warmup: "2 serie leggere di riscaldamento prima della prima serie di lavoro", equipmentType: "barbell" },
            { orderIndex: 2, name: "Lat Machine", sets: 4, repRange: "8-10", restSec: 90, intensity: "RPE 7-8", warmup: null, equipmentType: "cable" },
            { orderIndex: 3, name: "Military Press con Manubri", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 4, name: "Rematore Monobraccio con Manubrio", sets: 3, repRange: "8-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 5, name: "Curl Bicipiti con Manubri", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "dumbbell" },
            { orderIndex: 6, name: "Push Down Tricipiti ai Cavi", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "cable" },
          ],
        },
        {
          name: "Allenamento Parte Inferiore",
          exercises: [
            { orderIndex: 1, name: "Squat con Bilanciere", sets: 4, repRange: "6-10", restSec: 150, intensity: "RPE 7-8", warmup: "2-3 serie di riscaldamento crescenti prima della prima serie di lavoro", equipmentType: "barbell" },
            { orderIndex: 2, name: "Stacco Rumeno con Bilanciere", sets: 3, repRange: "8-10", restSec: 120, intensity: "RPE 7-8", warmup: null, equipmentType: "barbell" },
            { orderIndex: 3, name: "Leg Press", sets: 3, repRange: "10-12", restSec: 90, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 4, name: "Leg Curl", sets: 3, repRange: "10-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 5, name: "Calf Raise in Piedi", sets: 3, repRange: "12-15", restSec: 60, intensity: "RPE 7", warmup: null, equipmentType: "machine" },
            { orderIndex: 6, name: "Plank", sets: 3, repRange: "30-45 sec", restSec: 45, intensity: "vicino al cedimento", warmup: null, equipmentType: "bodyweight" },
          ],
        },
      ],
    }),
  },
};

function buildSystemPrompt(language: AppLanguage): string {
  const languageName = LANGUAGE_NAMES[language];
  return [
    "You design gym training programs from a short structured intake. Reply with ONLY valid JSON matching:",
    '{"plans":[{"name":string,"exercises":[{"orderIndex":number,"name":string,"sets":number,"repRange":string,"restSec":number,"intensity":string,"warmup":string|null,"equipmentType":"barbell"|"dumbbell"|"machine"|"cable"|"bodyweight"|"other"}]}]}',
    "",
    "Non-negotiable rules:",
    `- Every plan name, exercise name, and warmup/intensity text MUST be written in ${languageName} — this is not optional and does not follow the intake's own field labels (those stay in English internally). The one exception: an RPE-style intensity value (e.g. "RPE 7") stays as-is, that notation is language-neutral.`,
    "- You are a fitness coaching assistant, not a medical professional. Never diagnose. If injury notes suggest something serious, still design a safe, sensible plan — just avoid exercises/movement patterns that would plausibly aggravate the stated issue.",
    "- Never invent a precise numeric starting weight — there is no lift history yet for this user. `intensity` is always qualitative (e.g. \"RPE 7\"), never a kg number. Gender/age/weight/height, when given, only nudge exercise selection and volume tone — they are never inputs to a computed number.",
    "- `warmup` is null for almost every exercise. Only the FIRST heavy compound, cold-start movement of each plan (typically a squat/hinge/press-pattern barbell or heavy dumbbell lift) gets a short warmup note — isolation and machine work never needs one, the muscle is already warm.",
    `- Exercise names matching common real gym exercise names IN ${languageName.toUpperCase()} (not invented or obscure ones, not left in another language). Prefer machines and dumbbells over technically demanding barbell lifts for beginners.`,
    "- `repRange` as a short string (e.g. \"6-10\", or a timed hold like \"30-45 sec\" written in the target language's own numeral/unit convention). `restSec` in seconds. `orderIndex` starts at 1 per plan.",
    "- Exactly the number of plans specified below, each a genuinely different session (not near-duplicates of each other), 5-7 exercises per plan.",
  ].join("\n");
}

function buildHumanPrompt(input: GeneratePlanInput): string {
  const { splitName, planCount, planLabel } = splitFor(input.daysPerWeek, input.language);
  const lines = [
    `Goal: ${GOAL_LABELS[input.primaryGoal]}`,
    `Experience level: ${input.experienceLevel}`,
    `Days per week: ${input.daysPerWeek} -> split: ${splitName}, ${planCount} plans -> ${planLabel}`,
    `Volume rule: ${GOAL_VOLUME_RULES[input.primaryGoal]}`,
    `Gender: ${input.gender ?? "not given"}. Age: ${input.age ?? "not given"}. Weight: ${input.weightKg ?? "not given"}kg. Height: ${input.heightCm ?? "not given"}cm.`,
    `Injury notes: ${input.injuryNotes ?? "none"}.`,
    `Target language for every name and text field: ${LANGUAGE_NAMES[input.language]}.`,
  ];
  return lines.join("\n");
}

function generateModel(): ChatOpenRouter | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return new ChatOpenRouter({
    model: "google/gemini-3.1-flash-lite",
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens: 3072, // a 2-3 plan program, comparable to parse.ts's 4096 cap for parsing up to 10
    temperature: 0.3, // low but non-zero: follow the decision rules closely, allow some exercise-selection variety
    siteName: "Notch",
  });
}

export async function generateWorkoutPlan(
  input: GeneratePlanInput,
  commonExercises: CommonExercise[],
): Promise<GeneratePlanResult | null> {
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
  const parsed = parsedPlanSchema.parse(extractJson(raw));

  return {
    plans: parsed.plans,
    // common_exercises is currently Hebrew-only (see lintPlan's doc comment)
    // — matching en/ar exercise names against it would silently fail and
    // produce FALSE "not covered" warnings on every pattern, which is worse
    // than no check at all. Suppressed until the seed list is translated.
    linterChecks: input.language === "he" ? lintPlan(parsed.plans, commonExercises) : [],
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
 *
 * Note: common_exercises is currently seeded in Hebrew only (§21's starter
 * list), so this match is expected to mostly miss for en/ar-generated
 * plans today — a real gap, not silently pretended away. It degrades to
 * "can't verify" rather than a false failure, which is the correct failure
 * mode until the seed list itself is translated.
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
