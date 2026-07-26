import { admin, allowRate, corsHeaders, getUser, json } from "../_shared/mod.ts";

/**
 * GYM-17: POST /session/log-set — idempotent write for the offline queue.
 * Replaying a synced set hits the (session_id, exercise_id, set_no) unique
 * key and no-ops instead of duplicating.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "log-set", 60, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let body: {
    sessionId: string;
    exerciseId: string;
    setNo: number;
    weightKg: number;
    reps: number;
    note?: string;
  };
  try {
    body = await req.json();
    if (
      typeof body.sessionId !== "string" ||
      typeof body.exerciseId !== "string" ||
      !Number.isInteger(body.setNo) || body.setNo < 1 || body.setNo > 20 ||
      typeof body.weightKg !== "number" || body.weightKg < 0 ||
      !Number.isInteger(body.reps) || body.reps < 0 || body.reps > 200 ||
      (body.note !== undefined && typeof body.note !== "string")
    ) throw new Error();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  // Ownership: the session must belong to the caller and still be open.
  const { data: session } = await db
    .from("workout_sessions")
    .select("id, plan_id")
    .eq("id", body.sessionId)
    .eq("user_id", user.id)
    .eq("status", "in_progress")
    .maybeSingle();
  if (!session) return json(404, { error: "session_not_found" });

  // The exercise must belong to this session's plan — otherwise a caller
  // could log sets against (and later read back) another user's exercise.
  const { data: exercise } = await db
    .from("exercises")
    .select("id")
    .eq("id", body.exerciseId)
    .eq("plan_id", session.plan_id)
    .maybeSingle();
  if (!exercise) return json(404, { error: "exercise_not_found" });

  // Last write wins: an identical replay from the offline queue is a
  // harmless overwrite; a re-send with corrected weight/reps actually
  // lands instead of being silently dropped.
  const { error } = await db.from("set_logs").upsert(
    {
      session_id: body.sessionId,
      exercise_id: body.exerciseId,
      set_no: body.setNo,
      weight_kg: body.weightKg,
      reps: body.reps,
      note: body.note ?? null,
    },
    { onConflict: "session_id,exercise_id,set_no" },
  );
  if (error) return json(500, { error: "write_failed" });

  return json(200, { recorded: true });
});
