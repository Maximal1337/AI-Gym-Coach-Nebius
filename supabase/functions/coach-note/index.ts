import { admin, allowRate, corsHeaders, getUser, json } from "../_shared/mod.ts";

/**
 * GYM-22 (write side): save a note about an exercise ("knee felt tight").
 * The read side is folded into every coaching turn via notesForExercise.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "coach-note", 20, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let body: { exerciseId?: string; note: string };
  try {
    body = await req.json();
    if (
      typeof body.note !== "string" || body.note.length < 1 || body.note.length > 1000 ||
      (body.exerciseId !== undefined && typeof body.exerciseId !== "string")
    ) throw new Error();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  if (body.exerciseId) {
    // The exercise must belong to one of the caller's plans.
    const { data: exercise } = await db
      .from("exercises")
      .select("id, training_plans!inner(user_id)")
      .eq("id", body.exerciseId)
      .eq("training_plans.user_id", user.id)
      .maybeSingle();
    if (!exercise) return json(404, { error: "exercise_not_found" });
  }

  const { error } = await db.from("coach_notes").insert({
    user_id: user.id,
    exercise_id: body.exerciseId ?? null,
    note: body.note,
  });
  if (error) return json(500, { error: "write_failed" });

  return json(200, { saved: true });
});
