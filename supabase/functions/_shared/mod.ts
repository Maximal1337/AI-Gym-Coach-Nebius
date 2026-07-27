import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Shared plumbing for all Edge Functions.
 *
 * SECURITY MODEL: the admin client bypasses RLS. Every query made with it
 * MUST filter by the authenticated user's id explicitly — treat a missing
 * `.eq("user_id", user.id)` (or ownership check) as a data leak.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Resolve the calling user from their JWT. Every endpoint requires this. */
export async function getUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

/** GYM-54: fixed-window per-user rate limit. */
export async function allowRate(
  db: SupabaseClient,
  userId: string,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const windowStart = new Date(
    Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000,
  ).toISOString();
  const { data, error } = await db.rpc("bump_rate", {
    p_user_id: userId,
    p_bucket: bucket,
    p_window_start: windowStart,
  });
  if (error) return false; // fail closed
  return (data as number) <= limit;
}

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/**
 * GYM-21: monthly budget check — done once per session start.
 * Units are CENTS: the default of 8¢/user/month ≈ 12-13 sessions on
 * Gemini 3.1 Flash-Lite at ~0.6¢ each. Deliberately advisory-precision:
 * concurrent starts within one rate-limit window can overshoot by a few
 * sessions, which at these prices is a fraction of a cent.
 */
export async function budgetRemaining(
  db: SupabaseClient,
  userId: string,
): Promise<{ ok: boolean; spentCents: number; budgetCents: number }> {
  const budgetCents = Number(Deno.env.get("USAGE_MONTHLY_BUDGET_CENTS") ?? "8");
  const { data } = await db
    .from("usage_ledger")
    .select("cost_cents")
    .eq("user_id", userId)
    .eq("period", currentPeriod())
    .maybeSingle();
  const spentCents = Number(data?.cost_cents ?? 0);
  return { ok: spentCents < budgetCents, spentCents, budgetCents };
}

export async function recordUsage(
  db: SupabaseClient,
  userId: string,
  usage: { tokensInput: number; tokensOutput: number; costCents: number },
): Promise<void> {
  const { error } = await db.rpc("record_usage", {
    p_user_id: userId,
    p_period: currentPeriod(),
    p_tokens_input: usage.tokensInput,
    p_tokens_output: usage.tokensOutput,
    p_cost_cents: usage.costCents,
  });
  if (error) {
    // A silent failure here is a budget leak — surface it in function logs.
    console.error("record_usage failed", { userId, error: error.message });
  }
}

/** Call the agent service. GYM-56's kill switch lives on the agent side. */
export async function callAgent(
  payload: unknown,
  path = "/turn",
): Promise<Response> {
  const url = Deno.env.get("AGENT_URL");
  const secret = Deno.env.get("AGENT_SHARED_SECRET");
  if (!url || !secret) {
    return new Response(JSON.stringify({ error: "agent_not_configured" }), {
      status: 503,
    });
  }
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-secret": secret },
    body: JSON.stringify(payload),
  });
}

/** Camel-case a coach_profiles row into the agent's expected shape. */
export function profileToAgent(row: Record<string, unknown>) {
  return {
    userId: row.user_id,
    coachName: row.coach_name,
    language: row.language,
    tonePreset: row.tone_preset,
    accountabilityStyle: row.accountability_style,
    personaFreeform: row.persona_freeform ?? null,
  };
}

/** Camel-case an exercises row into the agent's expected shape. */
export function exerciseToAgent(row: Record<string, unknown>) {
  return {
    id: row.id,
    planId: row.plan_id,
    orderIndex: row.order_index,
    name: row.name,
    sets: row.sets,
    repRange: row.rep_range,
    restSec: row.rest_sec,
    intensity: row.intensity,
    warmup: row.warmup ?? null,
  };
}

/** Camel-case set_logs rows into the agent's expected shape. */
export function setLogsToAgent(rows: Record<string, unknown>[]) {
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    exerciseId: r.exercise_id,
    setNo: r.set_no,
    weightKg: Number(r.weight_kg),
    reps: r.reps,
    note: r.note ?? null,
    createdAt: r.created_at,
  }));
}

/**
 * Last completed-session logs for one exercise (the "last time" memory).
 * Ordered by when the session was TRAINED (started_at), not when its rows
 * synced — an offline Monday session synced on Thursday must not shadow
 * Wednesday's session.
 */
export async function lastLogsForExercise(
  db: SupabaseClient,
  userId: string,
  exerciseId: string,
): Promise<Record<string, unknown>[]> {
  const { data: lastSession } = await db
    .from("set_logs")
    .select("session_id, workout_sessions!inner(user_id, started_at, status)")
    .eq("exercise_id", exerciseId)
    .eq("workout_sessions.user_id", userId)
    .eq("workout_sessions.status", "completed")
    .order("started_at", {
      referencedTable: "workout_sessions",
      ascending: false,
    })
    .limit(1)
    .maybeSingle();
  if (!lastSession) return [];
  const { data } = await db
    .from("set_logs")
    .select("*")
    .eq("session_id", lastSession.session_id)
    .eq("exercise_id", exerciseId)
    .order("set_no", { ascending: true });
  return data ?? [];
}

/**
 * Saved coach notes for this exercise (GYM-22 read side) — includes
 * general notes (exercise_id is null), which apply to every exercise.
 */
export async function notesForExercise(
  db: SupabaseClient,
  userId: string,
  exerciseId: string,
): Promise<string[]> {
  const { data } = await db
    .from("coach_notes")
    .select("note")
    .eq("user_id", userId)
    .or(`exercise_id.eq.${exerciseId},exercise_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []).map((r) => r.note as string);
}

/**
 * Free-text mid-workout turn (GYM-61/67), used by coach-turn once a
 * session is running: interpret what the user said about `exercise`
 * (report of completed sets, or something else), persist any sets the
 * agent extracted, and — if it decided to advance — hand back the id of
 * the next exercise (or signal the workout is complete).
 */
export async function runConversationExerciseTurn(
  db: SupabaseClient,
  params: {
    userId: string;
    sessionId: string;
    planId: string;
    exercise: Record<string, unknown>;
    userMessage: string;
    recentHistory: Array<{ from: "coach" | "me"; text: string }>;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { userId, sessionId, planId, exercise, userMessage, recentHistory } = params;

  const [{ data: profileRow }, { data: planExercises }] = await Promise.all([
    db.from("coach_profiles").select("*").eq("user_id", userId).maybeSingle(),
    db.from("exercises").select("*").eq("plan_id", planId)
      .order("order_index", { ascending: true }),
  ]);
  if (!profileRow) return { status: 409, body: { error: "no_coach_profile" } };
  const ordered = planExercises ?? [];
  const currentIdx = ordered.findIndex((e) => e.id === exercise.id);
  const nextRow = currentIdx >= 0 ? ordered[currentIdx + 1] ?? null : null;

  const [lastLogs, notes, nextLastLogs, nextNotes] = await Promise.all([
    lastLogsForExercise(db, userId, exercise.id as string),
    notesForExercise(db, userId, exercise.id as string),
    nextRow ? lastLogsForExercise(db, userId, nextRow.id as string) : Promise.resolve([]),
    nextRow ? notesForExercise(db, userId, nextRow.id as string) : Promise.resolve([]),
  ]);

  const agentRes = await callAgent(
    {
      profile: profileToAgent(profileRow),
      exercise: exerciseToAgent(exercise),
      lastLogs: setLogsToAgent(lastLogs),
      notes,
      userMessage,
      recentHistory,
      nextExercise: nextRow ? exerciseToAgent(nextRow) : null,
      nextLastLogs: setLogsToAgent(nextLastLogs),
      nextNotes,
    },
    "/converse",
  );
  if (!agentRes.ok) return { status: 503, body: { error: "coach_unavailable" } };

  const turn = await agentRes.json();
  await recordUsage(db, userId, turn.usage);

  if (turn.advance && Array.isArray(turn.loggedSets) && turn.loggedSets.length > 0) {
    const rows = turn.loggedSets.map(
      (s: { weightKg: number; reps: number }, i: number) => ({
        session_id: sessionId,
        exercise_id: exercise.id,
        set_no: i + 1,
        weight_kg: s.weightKg,
        reps: s.reps,
      }),
    );
    const { error } = await db
      .from("set_logs")
      .upsert(rows, { onConflict: "session_id,exercise_id,set_no" });
    if (error) {
      console.error("set_logs upsert failed", { userId, sessionId, error: error.message });
    }
  }

  return {
    status: 200,
    body: {
      message: turn.message,
      advance: !!turn.advance,
      nextExerciseId: turn.advance ? (nextRow?.id ?? null) : exercise.id,
      sessionComplete: !!turn.advance && !nextRow,
      degraded: !!turn.degraded,
    },
  };
}

/**
 * Shared core of session-start and coach-turn: gather context for one
 * exercise, run the agent, record usage, shape the response.
 */
export async function runExerciseTurn(
  db: SupabaseClient,
  userId: string,
  planId: string,
  exercise: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Plan context (GYM-20): the coach should know the whole workout, not
  // just the current exercise. All four reads are independent of each
  // other (only the profile-missing check gates anything downstream),
  // so they run in one round trip instead of four.
  const [{ data: profileRow }, { data: plan }, { data: planExercises }, lastLogs, notes] =
    await Promise.all([
      db.from("coach_profiles").select("*").eq("user_id", userId).maybeSingle(),
      db.from("training_plans").select("name").eq("id", planId)
        .eq("user_id", userId).maybeSingle(),
      db.from("exercises").select("name, order_index").eq("plan_id", planId)
        .order("order_index", { ascending: true }),
      lastLogsForExercise(db, userId, exercise.id as string),
      notesForExercise(db, userId, exercise.id as string),
    ]);
  if (!profileRow) return { status: 409, body: { error: "no_coach_profile" } };

  const agentRes = await callAgent({
    userId,
    planId,
    planName: plan?.name ?? "",
    planExercises: (planExercises ?? []).map((e) => ({
      name: e.name,
      orderIndex: e.order_index,
    })),
    profile: profileToAgent(profileRow),
    exercise: exerciseToAgent(exercise),
    lastLogs: setLogsToAgent(lastLogs),
    notes,
  });
  if (!agentRes.ok) return { status: 503, body: { error: "coach_unavailable" } };

  const turn = await agentRes.json();
  await recordUsage(db, userId, turn.usage);

  return {
    status: 200,
    body: {
      exerciseId: exercise.id,
      message: turn.message,
      suggestedWeightKg: turn.suggestedWeightKg,
      targetReps: turn.targetReps,
      degraded: turn.degraded,
    },
  };
}
