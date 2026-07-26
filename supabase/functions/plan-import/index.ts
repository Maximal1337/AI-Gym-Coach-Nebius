import { admin, allowRate, callAgent, corsHeaders, getUser, json } from "../_shared/mod.ts";

/**
 * GYM-26: paste-and-parse plan onboarding.
 *  { action: "parse", text }  -> parsed preview (nothing written)
 *  { action: "commit", plans } -> archive all active plans, insert new ones
 * Two steps by design: the user always confirms what the parser understood
 * before anything is saved.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const db = admin();
  if (!(await allowRate(db, user.id, "plan-import", 10, 60))) {
    return json(429, { error: "rate_limited" });
  }

  let body: { action: string; text?: string; plans?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  if (body.action === "parse") {
    if (typeof body.text !== "string" || body.text.length < 10 || body.text.length > 20000) {
      return json(400, { error: "invalid_input" });
    }
    const res = await callAgent({ text: body.text }, "/parse-plan");
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
      }>;
    }>;
    if (!Array.isArray(plans) || plans.length === 0 || plans.length > 10) {
      return json(400, { error: "invalid_input" });
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
          (e.warmup !== null && (typeof e.warmup !== "string" || e.warmup.length > 300))
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
    const created: Array<{ id: string; name: string }> = [];
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
      const { error: exError } = await db.from("exercises").insert(
        p.exercises.map((e) => ({
          plan_id: plan.id,
          order_index: e.orderIndex,
          name: e.name,
          sets: e.sets,
          rep_range: e.repRange,
          rest_sec: e.restSec,
          intensity: e.intensity,
          warmup: e.warmup,
        })),
      );
      if (exError) {
        await rollback();
        return json(500, { error: "write_failed" });
      }
      created.push(plan);
    }

    // Pasting a new program archives everything before it (System Design §5).
    await db.from("training_plans")
      .update({ status: "archived" })
      .eq("user_id", user.id)
      .eq("status", "active")
      .not("id", "in", `(${createdIds.join(",")})`);

    return json(200, { plans: created });
  }

  return json(400, { error: "unknown_action" });
});
