import {
  admin,
  allowRate,
  corsHeaders,
  getUser,
  json,
  runExerciseTurn,
} from "../_shared/mod.ts";

/** A workout session older than this can no longer drive coaching turns. */
const SESSION_MAX_AGE_MS = 6 * 3600_000;

/**
 * Mid-workout coaching turn: "give me the briefing for exercise X".
 * Part of GYM-16's session flow.
 *
 * No budget check by design (a running session always finishes) — but the
 * session must be genuinely running: turns on sessions older than 6h are
 * rejected, so a parked "in_progress" session can't become an unmetered
 * LLM faucet.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "coach-turn", 20, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let sessionId: string, exerciseId: string;
  try {
    ({ sessionId, exerciseId } = await req.json());
    if (typeof sessionId !== "string" || typeof exerciseId !== "string") throw new Error();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  const { data: session } = await db
    .from("workout_sessions")
    .select("id, plan_id, status, started_at")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .eq("status", "in_progress")
    .maybeSingle();
  if (!session) return json(404, { error: "session_not_found" });

  if (Date.now() - new Date(session.started_at).getTime() > SESSION_MAX_AGE_MS) {
    await db
      .from("workout_sessions")
      .update({ status: "abandoned" })
      .eq("id", session.id)
      .eq("user_id", user.id);
    return json(410, { error: "session_expired" });
  }

  const { data: exercise } = await db
    .from("exercises")
    .select("*")
    .eq("id", exerciseId)
    .eq("plan_id", session.plan_id)
    .maybeSingle();
  if (!exercise) return json(404, { error: "exercise_not_found" });

  const turn = await runExerciseTurn(db, user.id, session.plan_id, exercise);
  return json(turn.status, turn.body);
});
