import { admin, allowRate, budgetRemaining, callAgent, corsHeaders, getUser, json, recordUsage } from "../_shared/mod.ts";

const GOALS = ["strength", "hypertrophy", "general_fitness", "fat_loss"];
const LEVELS = ["beginner", "intermediate", "advanced"];
const GENDERS = ["male", "female", "other"];
const LANGUAGES = ["en", "he", "ar"];

/**
 * AI-generated training plans (System Design §21).
 *  POST { primaryGoal, experienceLevel, daysPerWeek, gender?, age?, weightKg?, heightCm?, injuryNotes?, language? }
 *    -> { plans, linterChecks }  (preview only — nothing written to training_plans/exercises)
 *
 * The client commits the result through the EXISTING plan-import `commit`
 * action (mode "add" or omitted for onboarding) — same validated write path
 * a pasted plan already uses, real reuse rather than a second commit route.
 *
 * Budget is checked the same way session-start checks it (§10/§21): a
 * generation call is a real LLM call, drawing from the same monthly cap,
 * not a separate cost model.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();

  // Stricter than plan-import's 10/60 — this costs a real LLM call, not a
  // cheap parse; a handful of tries (including retries) is legitimate,
  // spamming it is not.
  if (!(await allowRate(db, user.id, "plan-generate", 5, 300))) {
    return json(429, { error: "rate_limited" });
  }

  const budget = await budgetRemaining(db, user.id);
  if (!budget.ok) {
    return json(402, {
      error: "monthly_budget_exhausted",
      spentCents: budget.spentCents,
      budgetCents: budget.budgetCents,
    });
  }

  let body: {
    primaryGoal?: string;
    experienceLevel?: string;
    daysPerWeek?: number;
    gender?: string | null;
    age?: number | null;
    weightKg?: number | null;
    heightCm?: number | null;
    injuryNotes?: string | null;
    language?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  if (
    typeof body.primaryGoal !== "string" || !GOALS.includes(body.primaryGoal) ||
    typeof body.experienceLevel !== "string" || !LEVELS.includes(body.experienceLevel) ||
    !Number.isInteger(body.daysPerWeek) || body.daysPerWeek! < 1 || body.daysPerWeek! > 6 ||
    (body.gender !== undefined && body.gender !== null && !GENDERS.includes(body.gender)) ||
    (body.age !== undefined && body.age !== null && (!Number.isInteger(body.age) || body.age < 10 || body.age > 100)) ||
    (body.weightKg !== undefined && body.weightKg !== null && (typeof body.weightKg !== "number" || body.weightKg < 20 || body.weightKg > 400)) ||
    (body.heightCm !== undefined && body.heightCm !== null && (typeof body.heightCm !== "number" || body.heightCm < 100 || body.heightCm > 250)) ||
    (body.injuryNotes !== undefined && body.injuryNotes !== null && (typeof body.injuryNotes !== "string" || body.injuryNotes.length > 500)) ||
    (body.language !== undefined && !LANGUAGES.includes(body.language))
  ) {
    return json(400, { error: "invalid_input" });
  }

  const intake = {
    primaryGoal: body.primaryGoal,
    experienceLevel: body.experienceLevel,
    daysPerWeek: body.daysPerWeek,
    gender: body.gender ?? null,
    age: body.age ?? null,
    weightKg: body.weightKg ?? null,
    heightCm: body.heightCm ?? null,
    injuryNotes: body.injuryNotes ?? null,
    // Which language the generated plan/exercise names must come back in —
    // the client's currently selected UI language, not a fixed default.
    language: body.language ?? "en",
  };

  // Persisted (§21) — reusable if the user regenerates or adds another plan
  // later, not a throwaway generation input. Written here only: same
  // one-choke-point discipline as every other non-persona table.
  await db.from("fitness_profiles").upsert({
    user_id: user.id,
    primary_goal: intake.primaryGoal,
    experience_level: intake.experienceLevel,
    days_per_week: intake.daysPerWeek,
    gender: intake.gender,
    age: intake.age,
    weight_kg: intake.weightKg,
    height_cm: intake.heightCm,
    injury_notes: intake.injuryNotes,
    updated_at: new Date().toISOString(),
  });

  const { data: commonExerciseRows } = await db
    .from("common_exercises")
    .select("name, muscle_group, movement_pattern, equipment_type, is_compound");
  const commonExercises = (commonExerciseRows ?? []).map((r) => ({
    name: r.name,
    muscleGroup: r.muscle_group,
    movementPattern: r.movement_pattern,
    equipmentType: r.equipment_type,
    isCompound: r.is_compound,
  }));

  const res = await callAgent({ intake, commonExercises }, "/generate-plan");
  if (!res.ok) {
    return json(res.status === 422 ? 422 : 503, {
      error: res.status === 422 ? "ungeneratable" : "generator_unavailable",
    });
  }
  const result = await res.json() as {
    plans: unknown;
    linterChecks: unknown;
    usage: { tokensInput: number; tokensOutput: number; costCents: number };
  };

  await recordUsage(db, user.id, result.usage);

  return json(200, { plans: result.plans, linterChecks: result.linterChecks });
});
