import { costCents } from "./assistant.ts";
import { tokenFactoryChat, TokenFactoryError } from "./token-factory.ts";

/**
 * AI-generated training plans (System Design §21) on Nebius Token Factory,
 * for the hackathon's app (DOR-135): Nemotron answers the intake with JSON
 * that a JSON schema holds it to, and the plan is validated here before the
 * preview, then committed through plan-import's `commit` like a pasted plan.
 *
 * A port of services/agent/src/generate.ts, which the live app runs on
 * Gemini through OpenRouter: the same prompt, the same one translated
 * few-shot example per language, the same output shape (plan-import's
 * parsedPlanSchema) and the same deterministic movement-pattern check. Keep
 * the two in step by hand.
 */

export const APP_LANGUAGES = ["en", "he", "ar", "es", "de", "pt", "fr", "it"] as const;
export type AppLanguage = typeof APP_LANGUAGES[number];
export const EQUIPMENT_TYPES = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "other"] as const;
export type EquipmentType = typeof EQUIPMENT_TYPES[number];

export interface GeneratePlanInput {
  primaryGoal: "strength" | "hypertrophy" | "general_fitness" | "fat_loss";
  experienceLevel: "beginner" | "intermediate" | "advanced";
  daysPerWeek: number;
  gender: "male" | "female" | "other" | null;
  age: number | null;
  weightKg: number | null;
  heightCm: number | null;
  injuryNotes: string | null;
  language: AppLanguage;
}

export interface CommonExercise {
  name: string;
  muscleGroup: string;
  movementPattern: "push" | "pull" | "squat" | "hinge" | "lunge" | "core" | "isolation";
  equipmentType: string;
  isCompound: boolean;
}

export interface PlanExercise {
  orderIndex: number;
  name: string;
  sets: number;
  repRange: string;
  restSec: number;
  intensity: string;
  warmup: string | null;
  equipmentType: EquipmentType | null;
}

export interface GeneratedPlan {
  name: string;
  exercises: PlanExercise[];
}

// ------------------------------------------------------------ the prompt (generate.ts)

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

// ------------------------------------------------------------ the check (generate.ts)

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
export function lintPlan(plans: GeneratedPlan[], commonExercises: CommonExercise[]): LinterCheck[] {
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

// ------------------------------------------------------------ the call

/** The output plan-import's parsedPlanSchema takes, as the JSON schema Token Factory holds the model to. */
export function planJsonSchema(planCount: number): unknown {
  const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
  return {
    type: "object",
    additionalProperties: false,
    required: ["plans"],
    properties: {
      plans: {
        type: "array",
        minItems: planCount,
        maxItems: planCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "exercises"],
          properties: {
            name: text(120),
            exercises: {
              type: "array",
              minItems: 5,
              maxItems: 7,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["orderIndex", "name", "sets", "repRange", "restSec", "intensity", "warmup", "equipmentType"],
                properties: {
                  orderIndex: { type: "integer", minimum: 1 },
                  name: text(200),
                  sets: { type: "integer", minimum: 1, maximum: 20 },
                  repRange: { type: "string", maxLength: 20 },
                  restSec: { type: "integer", minimum: 0, maximum: 1800 },
                  intensity: { type: "string", maxLength: 200 },
                  warmup: { anyOf: [text(300), { type: "null" }] },
                  equipmentType: { anyOf: [{ type: "string", enum: [...EQUIPMENT_TYPES] }, { type: "null" }] },
                },
              },
            },
          },
        },
      },
    },
  };
}

export class PlanGenerationError extends Error {
  constructor(message: string, readonly spent: boolean, readonly usage?: { tokensInput: number; tokensOutput: number }) {
    super(message);
    this.name = "PlanGenerationError";
  }
}

const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isText = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.length <= max;

/**
 * plan-import's parsedPlanSchema, checked by hand (no zod in the functions):
 * 1 to 10 plans of 1 to 30 exercises. The prompt asks for fewer; the schema
 * holds the model to it, and this is what the commit path will accept.
 */
export function validatePlans(value: unknown): GeneratedPlan[] {
  const plans = (value as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(plans) || plans.length < 1 || plans.length > 10) throw new Error("plans: 1 to 10 expected");
  return plans.map((p, i) => {
    const plan = p as Record<string, unknown>;
    if (!isText(plan?.name, 1, 120)) throw new Error(`plans[${i}].name`);
    const exercises = plan.exercises;
    if (!Array.isArray(exercises) || exercises.length < 1 || exercises.length > 30) throw new Error(`plans[${i}].exercises: 1 to 30 expected`);
    return {
      name: (plan.name as string).trim(),
      exercises: exercises.map((e, j) => {
        const x = e as Record<string, unknown>;
        const at = `plans[${i}].exercises[${j}]`;
        if (!isInt(x?.orderIndex, 1, 1000)) throw new Error(`${at}.orderIndex`);
        if (!isText(x.name, 1, 200)) throw new Error(`${at}.name`);
        if (!isInt(x.sets, 1, 20)) throw new Error(`${at}.sets`);
        if (typeof x.repRange !== "string" || x.repRange.length > 20) throw new Error(`${at}.repRange`);
        if (!isInt(x.restSec, 0, 1800)) throw new Error(`${at}.restSec`);
        if (typeof x.intensity !== "string" || x.intensity.length > 200) throw new Error(`${at}.intensity`);
        if (x.warmup !== null && (typeof x.warmup !== "string" || x.warmup.length > 300)) throw new Error(`${at}.warmup`);
        const equipment = x.equipmentType ?? null;
        if (equipment !== null && !(EQUIPMENT_TYPES as readonly string[]).includes(equipment as string)) throw new Error(`${at}.equipmentType`);
        return {
          orderIndex: x.orderIndex as number,
          name: (x.name as string).trim(),
          sets: x.sets as number,
          repRange: x.repRange,
          restSec: x.restSec as number,
          intensity: x.intensity,
          warmup: x.warmup === null ? null : (x.warmup as string).trim() || null,
          equipmentType: equipment as EquipmentType | null,
        };
      }),
    };
  });
}

/**
 * The prompt's warm-up rule, made certain in code: only the first heavy
 * compound of each plan, its cold start, carries a warm-up — on 2026-10-22
 * Nemotron put one on every exercise in 2 of 24 plans. "Heavy compound" is
 * the first free-weight exercise (barbell or dumbbell) in order, or the
 * first exercise when there is none. It keeps its own warm-up, or else the
 * first one the model wrote in that plan; every other exercise has none. A
 * plan the model gave no warm-up keeps none: nothing is invented.
 */
export function oneWarmupPerPlan(plans: GeneratedPlan[]): GeneratedPlan[] {
  return plans.map((plan) => {
    const ordered = [...plan.exercises].sort((a, b) => a.orderIndex - b.orderIndex);
    const first = ordered.find((e) => e.equipmentType === "barbell" || e.equipmentType === "dumbbell") ?? ordered[0];
    const text = first?.warmup ?? ordered.find((e) => e.warmup)?.warmup ?? null;
    return { ...plan, exercises: plan.exercises.map((e) => ({ ...e, warmup: e === first ? text : null })) };
  });
}

function extractJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
}

export interface GeneratePlanResult {
  plans: GeneratedPlan[];
  linterChecks: LinterCheck[];
  usage: { tokensInput: number; tokensOutput: number; costCents: number };
  model: string;
}

export interface GeneratePlanOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * One generation. Thinking off: the schema does the structuring, and every
 * reasoning token would be paid for and waited on. Throws PlanGenerationError;
 * `spent` says whether the model ran, and with what usage, so the caller can
 * charge a failed attempt.
 */
export async function generatePlan(input: GeneratePlanInput, commonExercises: CommonExercise[], options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const fewShot = FEW_SHOT[input.language];
  const { planCount } = splitFor(input.daysPerWeek, input.language);
  let reply;
  try {
    reply = await tokenFactoryChat({
      apiKey: options.apiKey,
      model: options.model,
      messages: [
        { role: "system", content: buildSystemPrompt(input.language) },
        { role: "user", content: fewShot.input },
        { role: "assistant", content: fewShot.output },
        { role: "user", content: buildHumanPrompt(input) },
      ],
      jsonSchema: { name: "training_plans", schema: planJsonSchema(planCount) },
      maxTokens: 4096,
      reasoningEffort: "none",
      temperature: 0.3,
      timeoutMs: options.timeoutMs ?? 90_000,
      backoffMs: [1_000],
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  } catch (e) {
    const spent = e instanceof TokenFactoryError ? e.spent : true;
    throw new PlanGenerationError(`generation failed: ${String(e)}`, spent, (e as { usage?: { tokensInput: number; tokensOutput: number } }).usage);
  }
  const usage = reply.usage ?? { tokensInput: 0, tokensOutput: 0 };
  let plans: GeneratedPlan[];
  try {
    plans = oneWarmupPerPlan(validatePlans(extractJson(reply.content)));
  } catch (e) {
    throw new PlanGenerationError(`the model's plan didn't validate: ${e instanceof Error ? e.message : String(e)}`, true, usage);
  }
  return {
    plans,
    // common_exercises is seeded in Hebrew only (see lintPlan): matching
    // other languages' names against it would report false gaps.
    linterChecks: input.language === "he" ? lintPlan(plans, commonExercises) : [],
    usage: { ...usage, costCents: costCents(reply.model || options.model, usage) },
    model: reply.model,
  };
}
