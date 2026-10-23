import {
  admin,
  allowRate,
  budgetRemaining,
  corsHeaders,
  getUser,
  json,
  runExerciseTurn,
  subscriptionAccess,
  withSentry,
} from "../_shared/mod.ts";
import { coachAgent } from "../_coach/agent.ts";
import { coachFlagRefusal } from "../_shared/coach.ts";
import { abandonOtherSessions } from "./sessions.ts";

/**
 * GYM-16: POST /session/start  { planId }
 *
 * Entitlement (trial/subscription) and budget are checked HERE and only
 * here — a session already running is never cut off mid-set (System
 * Design §7).
 *
 * In the hackathon app the coach's intro is services/agent's code run in
 * this function on Token Factory (DOR-135, ../_shared/coach.ts): at My
 * Coach's daily ceiling a workout doesn't start, and only accounts with the
 * assistant (assistant_chat) start one.
 * Secrets: COACH_TOKEN_FACTORY_API_KEY, COACH_MODEL (optional),
 * ASSISTANT_SPEND_CEILING_CENTS_COACH (optional).
 *
 * Idempotent against retries: an open session on the same plan is reused,
 * so a client that got a 503 mid-start doesn't strand orphan sessions. Once
 * a workout has started, the user's other open sessions are abandoned
 * (./sessions.ts) — the app never resumes them.
 */
Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "session-start", 5, 60))) {
    return json(429, { error: "rate_limited" });
  }

  // Only accounts with the assistant reach the model (_shared/coach.ts).
  const refusal = await coachFlagRefusal(db, user.id);
  if (refusal) return json(refusal.status, refusal.body);

  const access = await subscriptionAccess(db, user.id);
  if (!access.ok) {
    return json(402, { error: "subscription_required", trialEndsAt: access.trialEndsAt });
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
    await abandonOtherSessions(db, user.id, existing.id);
    return json(200, { sessionId: existing.id, ...(existing.intro_response as Record<string, unknown>) });
  }

  let sessionId: string;
  if (existing?.id) {
    sessionId = existing.id as string;
  } else {
    const { data: session, error: sessionError } = await db
      .from("workout_sessions")
      .insert({ user_id: user.id, plan_id: plan.id, source: "live" })
      .select("id")
      .single();
    if (sessionError || !session) return json(500, { error: "session_create_failed" });
    sessionId = session.id as string;
  }

  const turn = await runExerciseTurn(db, user.id, plan.id, firstExercise, sessionId, coachAgent(db));
  if (turn.status === 200) {
    await db.from("workout_sessions").update({ intro_response: turn.body }).eq("id", sessionId);
    // Only a start that worked closes the others: a failed one leaves everything as it was.
    await abandonOtherSessions(db, user.id, sessionId);
  }
  return json(turn.status, { sessionId, ...turn.body });
}));
