import {
  admin,
  allowRate,
  confirmExerciseSets,
  corsHeaders,
  getUser,
  json,
  runConversationExerciseTurn,
  subscriptionAccess,
  withSentry,
} from "../_shared/mod.ts";

/** A workout session older than this can no longer drive coaching turns. */
const SESSION_MAX_AGE_MS = 6 * 3600_000;

/**
 * Mid-workout coaching turn (GYM-16/61/67): the user sends free text
 * about the current exercise ("I did 12, 11, 8", "let's stay at 77kg"),
 * the agent interprets it and — if it decided the exercise is done —
 * this endpoint has already logged the sets and moved to the next one.
 *
 * No budget check by design (a running session always finishes) — but
 * entitlement IS checked here, on every turn, not just at session-start.
 * Unlike the cost-abuse budget, subscription is the actual paywall: a
 * session left open across a trial's expiry must not become a way to
 * keep chatting with the coach for free indefinitely. The session's own
 * 6h max-age still applies underneath this, so a parked "in_progress"
 * session can't become an unmetered LLM faucet either way.
 */
Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "coach-turn", 20, 60))) {
    return json(429, { error: "rate_limited" });
  }

  const access = await subscriptionAccess(db, user.id);
  if (!access.ok) {
    return json(402, { error: "subscription_required", trialEndsAt: access.trialEndsAt });
  }

  let sessionId: string, exerciseId: string;
  let userMessage: string | undefined;
  let confirmedSets: Array<{ weightKg: number; reps: number }> | undefined;
  let recentHistory: Array<{ from: unknown; text: unknown }> = [];
  let clientMessageId: string | null = null;
  try {
    const body = await req.json();
    ({ sessionId, exerciseId } = body);
    if (typeof sessionId !== "string" || typeof exerciseId !== "string") throw new Error();
    if (body.clientMessageId !== undefined) {
      if (typeof body.clientMessageId !== "string" || body.clientMessageId.length > 100) throw new Error();
      clientMessageId = body.clientMessageId;
    }

    // Generative-UI confirm action (System Design §19): confirmedSets is a
    // deterministic alternative to userMessage — no LLM call, so it's
    // mutually exclusive with free text, never both.
    if (body.confirmedSets !== undefined) {
      const sets = body.confirmedSets;
      if (
        !Array.isArray(sets) || sets.length < 1 || sets.length > 20 ||
        !sets.every((s) =>
          typeof s === "object" && s !== null &&
          typeof s.weightKg === "number" && s.weightKg >= 0 && s.weightKg <= 500 &&
          typeof s.reps === "number" && Number.isInteger(s.reps) && s.reps >= 0 && s.reps <= 200
        )
      ) throw new Error();
      confirmedSets = sets;
    } else {
      if (
        typeof body.userMessage !== "string" ||
        body.userMessage.length < 1 ||
        body.userMessage.length > 200
      ) throw new Error();
      userMessage = body.userMessage;
      if (Array.isArray(body.recentHistory)) recentHistory = body.recentHistory;
    }
  } catch {
    return json(400, { error: "invalid_input" });
  }

  const cleanHistory = recentHistory
    .filter(
      (m): m is { from: "coach" | "me"; text: string } =>
        (m.from === "coach" || m.from === "me") &&
        typeof m.text === "string" && m.text.length <= 2000,
    )
    .slice(-12);

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

  if (confirmedSets) {
    const turn = await confirmExerciseSets(db, {
      userId: user.id,
      sessionId: session.id,
      planId: session.plan_id,
      exercise,
      confirmedSets,
      clientMessageId,
    });
    return json(turn.status, turn.body);
  }

  const turn = await runConversationExerciseTurn(db, {
    userId: user.id,
    sessionId: session.id,
    planId: session.plan_id,
    exercise,
    userMessage: userMessage!,
    recentHistory: cleanHistory,
    clientMessageId,
  });
  return json(turn.status, turn.body);
}));
