import { admin, allowRate, corsHeaders, getUser, json } from "../_shared/mod.ts";

/**
 * GYM-18: POST /session/complete — close the session, return the summary
 * the coach echoes back for user confirmation.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "session-complete", 10, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let sessionId: string;
  try {
    ({ sessionId } = await req.json());
    if (typeof sessionId !== "string") throw new Error();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  const { data: session } = await db
    .from("workout_sessions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .eq("status", "in_progress")
    .select("id, plan_id, started_at, completed_at")
    .maybeSingle();
  if (!session) return json(404, { error: "session_not_found" });

  const { data: logs } = await db
    .from("set_logs")
    .select("exercise_id, set_no, weight_kg, reps, exercises!inner(name, order_index)")
    .eq("session_id", session.id)
    .order("set_no", { ascending: true });

  const byExercise = new Map<string, { name: string; orderIndex: number; sets: string[] }>();
  for (const row of logs ?? []) {
    const ex = row.exercises as unknown as { name: string; order_index: number };
    const entry = byExercise.get(row.exercise_id) ??
      { name: ex.name, orderIndex: ex.order_index, sets: [] };
    entry.sets.push(`${Number(row.weight_kg)}kg×${row.reps}`);
    byExercise.set(row.exercise_id, entry);
  }

  return json(200, {
    sessionId: session.id,
    startedAt: session.started_at,
    completedAt: session.completed_at,
    exercises: [...byExercise.values()]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(({ name, sets }) => ({ name, sets })),
  });
});
