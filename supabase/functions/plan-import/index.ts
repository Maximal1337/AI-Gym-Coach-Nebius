import { admin, allowRate, callAgent, corsHeaders, getUser, json, subscriptionAccess, withSentry } from "../_shared/mod.ts";

/**
 * GYM-26: paste-and-parse plan onboarding. Also covers adding/editing
 * training types after onboarding (GYM-69), sharing the same parse step.
 *  { action: "parse", text }  -> parsed preview (nothing written)
 *  { action: "commit", plans, mode?, editPlanId? }
 *    mode omitted (onboarding, default) -> archive ALL active plans, insert new ones
 *    mode: "add"                        -> insert new plan(s), archive nothing
 *    mode: "edit", editPlanId           -> archive ONLY editPlanId, insert new plan(s)
 *  { action: "seed-starting-weights", entries } -> log one "last set" per exercise
 *    (guidelines/starting-weights.html) — the same source-imported session/
 *    set_logs shape history-import writes, one row per exercise, so the
 *    coach's normal cold-start read of "last time" just sees it.
 *  { action: "archive", planId } -> archive a single plan
 * Two steps by design for commit: the user always confirms what the
 * parser understood before anything is saved.
 */
Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "plan-import", 10, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let body: {
    action: string;
    text?: string;
    pdfBase64?: string;
    docxBase64?: string;
    imagesBase64?: string[];
    filename?: string;
    plans?: unknown;
    mode?: string;
    editPlanId?: string;
    planId?: string;
    entries?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  if (body.action === "parse") {
    // A real LLM call (unlike commit/seed-starting-weights/archive below,
    // which are pure DB writes) — gated the same as every other AI entry
    // point, whether this is first-time onboarding (new accounts are
    // always within their trial) or adding a workout type later.
    const access = await subscriptionAccess(db, user.id);
    if (!access.ok) {
      return json(402, { error: "subscription_required", trialEndsAt: access.trialEndsAt });
    }

    // Pasted text, an uploaded PDF/docx (client caps the raw file at 8MB
    // before ever uploading it; base64 inflates that by ~33%), or one or
    // more photographed pages (guidelines/photograph-plan.html — client
    // caps each photo at ~1.5MB raw, up to 3 pages, kept small since this
    // function's own request-size ceiling is tighter than the agent's).
    let agentPayload:
      | { text: string }
      | { pdfBase64: string; filename: string }
      | { docxBase64: string; filename: string }
      | { imagesBase64: string[] };
    if (Array.isArray(body.imagesBase64)) {
      const images = body.imagesBase64;
      if (
        images.length < 1 || images.length > 3 ||
        images.some((img) => typeof img !== "string" || img.length < 100 || img.length > 2 * 1024 * 1024)
      ) {
        return json(400, { error: "invalid_input" });
      }
      agentPayload = { imagesBase64: images };
    } else if (typeof body.pdfBase64 === "string" || typeof body.docxBase64 === "string") {
      const fileBase64 = body.pdfBase64 ?? body.docxBase64!;
      if (
        fileBase64.length < 100 || fileBase64.length > 16 * 1024 * 1024 ||
        typeof body.filename !== "string" || body.filename.length < 1 || body.filename.length > 200
      ) {
        return json(400, { error: "invalid_input" });
      }
      agentPayload = typeof body.pdfBase64 === "string"
        ? { pdfBase64: body.pdfBase64, filename: body.filename }
        : { docxBase64: body.docxBase64!, filename: body.filename };
    } else {
      if (typeof body.text !== "string" || body.text.length < 10 || body.text.length > 20000) {
        return json(400, { error: "invalid_input" });
      }
      agentPayload = { text: body.text };
    }
    const res = await callAgent(agentPayload, "/parse-plan");
    if (!res.ok) {
      return json(res.status === 422 ? 422 : 503, {
        error: res.status === 422 ? "unparseable" : "parser_unavailable",
      });
    }
    return json(200, await res.json());
  }

  if (body.action === "commit") {
    const plans = body.plans as Array<{
      name: string;
      exercises: Array<{
        orderIndex: number; name: string; sets: number; repRange: string;
        restSec: number; intensity: string; warmup: string | null;
        equipmentType: string | null;
      }>;
    }>;
    const EQUIPMENT_TYPES = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "other"];
    if (!Array.isArray(plans) || plans.length === 0 || plans.length > 10) {
      return json(400, { error: "invalid_input" });
    }
    const mode = body.mode as string | undefined;
    if (mode !== undefined && mode !== "add" && mode !== "edit") {
      return json(400, { error: "invalid_input" });
    }
    const editPlanId = body.editPlanId as string | undefined;
    if (mode === "edit") {
      if (typeof editPlanId !== "string") return json(400, { error: "invalid_input" });
      const { data: target } = await db
        .from("training_plans")
        .select("id")
        .eq("id", editPlanId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (!target) return json(404, { error: "plan_not_found" });
    }
    // Commit arrives as a separate client call, so the parse-path schema
    // doesn't protect this write — validate every field here.
    for (const p of plans) {
      if (typeof p.name !== "string" || p.name.length < 1 || p.name.length > 120 ||
        !Array.isArray(p.exercises) || p.exercises.length === 0 || p.exercises.length > 30) {
        return json(400, { error: "invalid_input" });
      }
      for (const e of p.exercises) {
        if (
          !Number.isInteger(e.orderIndex) || e.orderIndex < 1 || e.orderIndex > 99 ||
          typeof e.name !== "string" || e.name.length < 1 || e.name.length > 200 ||
          !Number.isInteger(e.sets) || e.sets < 1 || e.sets > 20 ||
          typeof e.repRange !== "string" || e.repRange.length > 20 ||
          !Number.isInteger(e.restSec) || e.restSec < 0 || e.restSec > 1800 ||
          typeof e.intensity !== "string" || e.intensity.length > 200 ||
          (e.warmup !== null && (typeof e.warmup !== "string" || e.warmup.length > 300)) ||
          (e.equipmentType !== null && !EQUIPMENT_TYPES.includes(e.equipmentType))
        ) {
          return json(400, { error: "invalid_input" });
        }
      }
    }

    // Insert the new program FIRST; only after everything landed, archive
    // what came before. A failure mid-way rolls back the new rows and
    // leaves the old program untouched — the user is never stranded
    // with zero active plans.
    const createdIds: string[] = [];
    const created: Array<{
      id: string;
      name: string;
      exercises: Array<{ id: string; name: string; sets: number; repRange: string }>;
    }> = [];
    const rollback = async () => {
      if (createdIds.length > 0) {
        await db.from("training_plans").delete().in("id", createdIds);
      }
    };
    for (const p of plans) {
      const { data: plan, error } = await db
        .from("training_plans")
        .insert({ user_id: user.id, name: p.name })
        .select("id, name")
        .single();
      if (error || !plan) {
        await rollback();
        return json(500, { error: "write_failed" });
      }
      createdIds.push(plan.id);
      const { data: insertedExercises, error: exError } = await db.from("exercises").insert(
        p.exercises.map((e) => ({
          plan_id: plan.id,
          order_index: e.orderIndex,
          name: e.name,
          sets: e.sets,
          rep_range: e.repRange,
          rest_sec: e.restSec,
          intensity: e.intensity,
          warmup: e.warmup,
          equipment_type: e.equipmentType,
        })),
      ).select("id, name, sets, rep_range");
      if (exError || !insertedExercises) {
        await rollback();
        return json(500, { error: "write_failed" });
      }
      created.push({
        ...plan,
        exercises: insertedExercises.map((e) => ({ id: e.id, name: e.name, sets: e.sets, repRange: e.rep_range })),
      });
    }

    // mode="add": archive nothing, the new type joins the existing ones.
    // mode="edit": archive only the one plan being replaced.
    // No mode (onboarding, System Design §5): archive everything else —
    // a first-time paste replaces the whole program.
    if (mode === "add") {
      // nothing to archive
    } else if (mode === "edit") {
      const { error: archiveError } = await db.from("training_plans")
        .update({ status: "archived" })
        .eq("id", editPlanId!)
        .eq("user_id", user.id);
      if (archiveError) {
        // The new plan is already committed and valid — not rolling that
        // back over a cleanup failure — but the old one silently staying
        // active would leave the user with two plans of the same type.
        console.error("edit-mode archive failed", { userId: user.id, editPlanId, error: archiveError.message });
      }
    } else {
      await db.from("training_plans")
        .update({ status: "archived" })
        .eq("user_id", user.id)
        .eq("status", "active")
        .not("id", "in", `(${createdIds.join(",")})`);
    }

    return json(200, { plans: created });
  }

  if (body.action === "seed-starting-weights") {
    const entries = body.entries as Array<{ exerciseId: string; weightKg: number; reps: number }>;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 60) {
      return json(400, { error: "invalid_input" });
    }
    for (const e of entries) {
      if (
        typeof e.exerciseId !== "string" ||
        typeof e.weightKg !== "number" || !Number.isFinite(e.weightKg) || e.weightKg < 0 || e.weightKg > 1000 ||
        !Number.isInteger(e.reps) || e.reps < 1 || e.reps > 200
      ) {
        return json(400, { error: "invalid_input" });
      }
    }

    // Scope to exercises on one of this user's own active plans — same
    // ownership check coach-note uses for a single exercise, extended to a
    // batch via `.in`.
    const { data: owned } = await db
      .from("exercises")
      .select("id, plan_id, training_plans!inner(user_id, status)")
      .in("id", entries.map((e) => e.exerciseId))
      .eq("training_plans.user_id", user.id)
      .eq("training_plans.status", "active");
    const planIdByExercise = new Map((owned ?? []).map((r) => [r.id as string, r.plan_id as string]));

    const byPlan = new Map<string, typeof entries>();
    for (const e of entries) {
      const planId = planIdByExercise.get(e.exerciseId);
      if (!planId) continue; // not this user's exercise -- skip rather than fail the whole batch
      byPlan.set(planId, [...(byPlan.get(planId) ?? []), e]);
    }
    if (byPlan.size === 0) return json(404, { error: "no_matching_exercises" });

    const now = new Date().toISOString();
    let seeded = 0;
    for (const [planId, planEntries] of byPlan) {
      const { data: session, error } = await db
        .from("workout_sessions")
        .insert({
          user_id: user.id,
          plan_id: planId,
          source: "imported",
          status: "completed",
          started_at: now,
          completed_at: now,
        })
        .select("id")
        .single();
      if (error || !session) return json(500, { error: "write_failed" });
      const { error: logError } = await db.from("set_logs").insert(
        planEntries.map((e) => ({
          session_id: session.id,
          exercise_id: e.exerciseId,
          set_no: 1,
          weight_kg: e.weightKg,
          reps: e.reps,
        })),
      );
      if (logError) return json(500, { error: "write_failed" });
      seeded += planEntries.length;
    }
    return json(200, { seeded });
  }

  if (body.action === "archive") {
    if (typeof body.planId !== "string") return json(400, { error: "invalid_input" });
    const { data: plan, error } = await db
      .from("training_plans")
      .update({ status: "archived" })
      .eq("id", body.planId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) return json(500, { error: "write_failed" });
    if (!plan) return json(404, { error: "plan_not_found" });
    return json(200, { archived: true });
  }

  return json(400, { error: "unknown_action" });
}));
