import {
  admin,
  allowRate,
  budgetRemaining,
  corsHeaders,
  getUser,
  json,
  runExerciseTurn,
} from "../_shared/mod.ts";

/**
 * GYM-16: POST /session/start  { planId }
 *
 * Budget is checked HERE and only here — a session already running is
 * never cut off mid-set (System Design §7).
 *
 * Idempotent against retries: an open session on the same plan is reused,
 * so a client that got a 503 mid-start doesn't strand orphan sessions.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "session-start", 5, 60))) {
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

  let planId: string;
  try {
    ({ planId } = await req.json());
    if (typeof planId !== "string") throw new Error();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  // Ownership + active check (admin client bypasses RLS — filter explicitly).
  const { data: plan } = await db
    .from("training_plans")
    .select("id, name, status")
    .eq("id", planId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!plan) return json(404, { error: "plan_not_found" });

  const { data: firstExercise } = await db
    .from("exercises")
    .select("*")
    .eq("plan_id", plan.id)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!firstExercise) return json(409, { error: "plan_has_no_exercises" });

  // Reuse a recent open session on this plan instead of creating a twin.
  const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: existing } = await db
    .from("workout_sessions")
    .select("id, intro_response")
    .eq("user_id", user.id)
    .eq("plan_id", plan.id)
    .eq("status", "in_progress")
    .gte("started_at", sixHoursAgo)
    .maybeSingle();

  // A client that backgrounds mid-request (killing the fetch, common during
  // Fly.io's cold-start window) and retries would otherwise pay for a
  // second LLM call for the same logical action — replay the cached
  // response instead of recomputing it whenever one's already on file.
  if (existing?.intro_response) {
    return json(200, { sessionId: existing.id, ...(existing.intro_response as Record<string, unknown>) });
  }

  let sessionId = existing?.id as string | undefined;
  if (!sessionId) {
    const { data: session, error: sessionError } = await db
      .from("workout_sessions")
      .insert({ user_id: user.id, plan_id: plan.id, source: "live" })
      .select("id")
      .single();
    if (sessionError || !session) return json(500, { error: "session_create_failed" });
    sessionId = session.id;
  }

  const turn = await runExerciseTurn(db, user.id, plan.id, firstExercise);
  if (turn.status === 200) {
    await db.from("workout_sessions").update({ intro_response: turn.body }).eq("id", sessionId);
  }
  return json(turn.status, { sessionId, ...turn.body });
});
