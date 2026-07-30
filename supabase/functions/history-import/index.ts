import { admin, allowRate, callAgent, corsHeaders, getUser, json } from "../_shared/mod.ts";

/**
 * GYM-48: import a pasted workout summary as historical set_logs.
 *  { action: "parse", text }    -> parsed preview, matched to current exercises
 *  { action: "commit", sessions } -> insert completed sessions (source=imported)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "history-import", 10, 60))) {
    return json(429, { error: "rate_limited" });
  }

  // Active exercises, for name matching and validation.
  const { data: activePlans } = await db
    .from("training_plans")
    .select("id, name, exercises(id, name)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const exerciseByName = new Map<string, { id: string; planId: string }>();
  const planNameById = new Map<string, string>();
  for (const p of activePlans ?? []) {
    planNameById.set(p.id, p.name);
    for (const e of (p.exercises as Array<{ id: string; name: string }>) ?? []) {
      exerciseByName.set(e.name, { id: e.id, planId: p.id });
    }
  }

  let body: { action: string; text?: string; sessions?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  if (body.action === "parse") {
    if (typeof body.text !== "string" || body.text.length < 10 || body.text.length > 20000) {
      return json(400, { error: "invalid_input" });
    }
    const res = await callAgent(
      { text: body.text, knownExercises: [...exerciseByName.keys()] },
      "/parse-summary",
    );
    if (!res.ok) {
      return json(res.status === 422 ? 422 : 503, {
        error: res.status === 422 ? "unparseable" : "parser_unavailable",
      });
    }
    const parsed = await res.json();
    // Annotate matches so the app can show, per log, which of the user's
    // actual training plans it's about to be logged into (matching is by
    // exercise name against the active plans, not the parser's free-text
    // guess at a plan name) — otherwise a commit is a leap of faith.
    for (const s of parsed.sessions ?? []) {
      for (const l of s.logs ?? []) {
        const match = exerciseByName.get(l.exerciseName);
        l.matched = !!match;
        l.matchedPlanName = match ? planNameById.get(match.planId) ?? null : null;
      }
    }
    return json(200, parsed);
  }

  if (body.action === "commit") {
    const sessions = body.sessions as Array<{
      date: string | null;
      logs: Array<{ exerciseName: string; setNo: number; weightKg: number; reps: number }>;
    }>;
    if (!Array.isArray(sessions) || sessions.length === 0 || sessions.length > 20) {
      return json(400, { error: "invalid_input" });
    }

    // Commit is a user-confirmed one-shot; a retried partial failure can
    // duplicate sessions — acceptable for MVP, the user sees and can
    // delete via account data. Logs are grouped by the plan each exercise
    // actually belongs to, so a mixed paste never mis-attributes.
    let imported = 0;
    for (const s of sessions) {
      const matched = (s.logs ?? []).filter((l) => exerciseByName.has(l.exerciseName));
      if (matched.length === 0) continue;
      const byPlan = new Map<string, typeof matched>();
      for (const l of matched) {
        const planId = exerciseByName.get(l.exerciseName)!.planId;
        byPlan.set(planId, [...(byPlan.get(planId) ?? []), l]);
      }
      // Only ISO-like dates are trusted; anything else imports as "today"
      // and is surfaced to the user in the parse preview beforehand.
      const parsedDate = s.date && /^\d{4}-\d{2}-\d{2}/.test(s.date) ? Date.parse(s.date) : NaN;
      const startedAt = Number.isNaN(parsedDate)
        ? new Date().toISOString()
        : new Date(parsedDate).toISOString();
      for (const [planId, logs] of byPlan) {
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
          logs.map((l) => ({
            session_id: session.id,
            exercise_id: exerciseByName.get(l.exerciseName)!.id,
            set_no: l.setNo,
            weight_kg: l.weightKg,
            reps: l.reps,
          })),
        );
        if (logError) return json(500, { error: "write_failed" });
        imported++;
      }
    }
    return json(200, { imported });
  }

  return json(400, { error: "unknown_action" });
});
