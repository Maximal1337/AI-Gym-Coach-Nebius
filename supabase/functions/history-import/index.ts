import { admin, allowRate, callAgent, corsHeaders, getUser, json, subscriptionAccess, withSentry } from "../_shared/mod.ts";

/**
 * GYM-48: import a pasted workout summary as historical set_logs.
 *  { action: "parse", text }    -> parsed preview, matched to current exercises
 *  { action: "commit", sessions } -> insert completed sessions (source=imported)
 */
Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "history-import", 10, 60))) {
    return json(429, { error: "rate_limited" });
  }

  // Active exercises, for name matching and validation. A user has SEVERAL
  // active plans at once (one per workout type), and the same exercise name
  // (e.g. "Bench Press") commonly recurs across them as distinct rows — so
  // matching can't just key on name globally, or one plan's exercise id
  // silently wins and imported sets land against the wrong plan (GYM bug:
  // import reports success, but the plan the user actually meant never
  // sees the new history). Resolution order per name: unique across active
  // plans -> unambiguous; otherwise only resolve if the parsed session's
  // own guessed plan name (planName) picks out exactly one of the
  // colliding plans; otherwise leave it unmatched rather than guess.
  const { data: activePlans } = await db
    .from("training_plans")
    .select("id, name, exercises(id, name)")
    .eq("user_id", user.id)
    .eq("status", "active");
  interface PlanInfo { id: string; name: string; exerciseIdByName: Map<string, string> }
  const plans: PlanInfo[] = [];
  const planIdsByExerciseName = new Map<string, string[]>();
  for (const p of activePlans ?? []) {
    const exerciseIdByName = new Map<string, string>();
    for (const e of (p.exercises as Array<{ id: string; name: string }>) ?? []) {
      exerciseIdByName.set(e.name, e.id);
      planIdsByExerciseName.set(e.name, [...(planIdsByExerciseName.get(e.name) ?? []), p.id]);
    }
    plans.push({ id: p.id, name: p.name, exerciseIdByName });
  }
  const planById = new Map(plans.map((p) => [p.id, p]));

  function resolveExercise(
    exerciseName: string,
    sessionPlanName: string | null | undefined,
  ): { id: string; planId: string } | null {
    const candidatePlanIds = planIdsByExerciseName.get(exerciseName);
    if (!candidatePlanIds || candidatePlanIds.length === 0) return null;
    if (candidatePlanIds.length === 1) {
      const plan = planById.get(candidatePlanIds[0])!;
      return { id: plan.exerciseIdByName.get(exerciseName)!, planId: plan.id };
    }
    if (sessionPlanName) {
      const norm = sessionPlanName.trim().toLowerCase();
      const hit = candidatePlanIds.filter((pid) => planById.get(pid)!.name.trim().toLowerCase() === norm);
      if (hit.length === 1) {
        const plan = planById.get(hit[0])!;
        return { id: plan.exerciseIdByName.get(exerciseName)!, planId: plan.id };
      }
    }
    return null; // genuinely ambiguous across active plans -- don't guess
  }

  let body: { action: string; text?: string; sessions?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  if (body.action === "parse") {
    const access = await subscriptionAccess(db, user.id);
    if (!access.ok) {
      return json(402, { error: "subscription_required", trialEndsAt: access.trialEndsAt });
    }
    if (typeof body.text !== "string" || body.text.length < 10 || body.text.length > 20000) {
      return json(400, { error: "invalid_input" });
    }
    const res = await callAgent(
      { text: body.text, knownExercises: [...planIdsByExerciseName.keys()] },
      "/parse-summary",
    );
    if (!res.ok) {
      return json(res.status === 422 ? 422 : 503, {
        error: res.status === 422 ? "unparseable" : "parser_unavailable",
      });
    }
    const parsed = await res.json();
    // Annotate matches so the app can show, per log, which of the user's
    // actual training plans it's about to be logged into — otherwise a
    // commit is a leap of faith. The parser's own planName guess is used
    // only to break ties when an exercise name collides across plans;
    // it never substitutes for a real exercise-name match.
    for (const s of parsed.sessions ?? []) {
      for (const l of s.logs ?? []) {
        const match = resolveExercise(l.exerciseName, s.planName);
        l.matched = !!match;
        l.matchedPlanName = match ? planById.get(match.planId)!.name : null;
      }
    }
    return json(200, parsed);
  }

  if (body.action === "commit") {
    // Defense in depth, same reasoning as studio-session's update/save
    // gate: the normal UI path can only reach commit after parse (already
    // gated), but a client holding a preview from before the trial ended
    // shouldn't still be able to write it.
    const access = await subscriptionAccess(db, user.id);
    if (!access.ok) {
      return json(402, { error: "subscription_required", trialEndsAt: access.trialEndsAt });
    }

    const sessions = body.sessions as Array<{
      date: string | null;
      planName?: string | null;
      logs: Array<{ exerciseName: string; setNo: number; weightKg: number; reps: number }>;
    }>;
    if (!Array.isArray(sessions) || sessions.length === 0 || sessions.length > 20) {
      return json(400, { error: "invalid_input" });
    }

    // Commit is a user-confirmed one-shot; a retried partial failure can
    // duplicate sessions — acceptable for MVP, the user sees and can
    // delete via account data. Logs are grouped by the plan each exercise
    // actually belongs to (via resolveExercise, using this session's own
    // planName to break a same-name-across-plans tie), so a mixed paste
    // never mis-attributes.
    let imported = 0;
    for (const s of sessions) {
      const resolved: Array<{
        log: { exerciseName: string; setNo: number; weightKg: number; reps: number };
        match: { id: string; planId: string };
      }> = [];
      for (const log of s.logs ?? []) {
        const match = resolveExercise(log.exerciseName, s.planName);
        if (match) resolved.push({ log, match });
      }
      if (resolved.length === 0) continue;
      const byPlan = new Map<string, typeof resolved>();
      for (const r of resolved) {
        byPlan.set(r.match.planId, [...(byPlan.get(r.match.planId) ?? []), r]);
      }
      // Only ISO-like dates are trusted; anything else imports as "today"
      // and is surfaced to the user in the parse preview beforehand.
      const parsedDate = s.date && /^\d{4}-\d{2}-\d{2}/.test(s.date) ? Date.parse(s.date) : NaN;
      const startedAt = Number.isNaN(parsedDate)
        ? new Date().toISOString()
        : new Date(parsedDate).toISOString();
      for (const [planId, entries] of byPlan) {
        const { data: session, error } = await db
          .from("workout_sessions")
          .insert({
            user_id: user.id,
            plan_id: planId,
            source: "imported",
            status: "completed",
            started_at: startedAt,
            completed_at: startedAt,
          })
          .select("id")
          .single();
        if (error || !session) return json(500, { error: "write_failed" });
        const { error: logError } = await db.from("set_logs").insert(
          entries.map(({ log, match }) => ({
            session_id: session.id,
            exercise_id: match.id,
            set_no: log.setNo,
            weight_kg: log.weightKg,
            reps: log.reps,
          })),
        );
        if (logError) return json(500, { error: "write_failed" });
        imported++;
      }
    }
    return json(200, { imported });
  }

  return json(400, { error: "unknown_action" });
}));
