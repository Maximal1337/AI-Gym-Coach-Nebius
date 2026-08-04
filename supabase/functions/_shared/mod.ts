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
 * Units are CENTS: the default of 8¢/user/month. The ~0.6¢/session figure
 * this cap was sized against holds up against real usage: recorded cost
 * (usage_ledger, July 2026) came in at ≈0.07¢ per exercise turn, almost
 * exactly the ~0.06¢/call this was originally estimated at, so 8¢ still
 * covers the originally-estimated ~12-13 full workouts a month, not more.
 * Deliberately advisory-precision either way: concurrent starts within one
 * rate-limit window can overshoot by a few sessions, which at these prices
 * is a fraction of a cent.
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
    equipmentType: row.equipment_type ?? null,
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
  // Any session counts toward progression, not just completed ones — an
  // abandoned/still-in-progress session's logged sets are still real
  // performance data the user shouldn't have to repeat.
  //
  // The "most recent" pick is done here in code, not via a PostgREST
  // order — .order(col, { referencedTable }) only sorts rows *within* an
  // embedded array relationship, it does not order the outer set_logs
  // query by its joined session's started_at (confirmed against a real
  // production mix-up: it silently returned the OLDEST matching session
  // instead of the newest). Fetching every candidate row and reducing to
  // the max started_at in JS sidesteps that PostgREST limitation.
  const { data: rows } = await db
    .from("set_logs")
    .select("session_id, workout_sessions!inner(user_id, started_at)")
    .eq("exercise_id", exerciseId)
    .eq("workout_sessions.user_id", userId);
  if (!rows || rows.length === 0) return [];
  let lastSessionId: string | null = null;
  let latestStartedAt = -Infinity;
  for (const row of rows) {
    const session = row.workout_sessions as unknown as { started_at: string };
    const startedAt = new Date(session.started_at).getTime();
    if (startedAt > latestStartedAt) {
      latestStartedAt = startedAt;
      lastSessionId = row.session_id as string;
    }
  }
  if (!lastSessionId) return [];
  const { data } = await db
    .from("set_logs")
    .select("*")
    .eq("session_id", lastSessionId)
    .eq("exercise_id", exerciseId)
    .order("set_no", { ascending: true });
  return data ?? [];
}

/**
 * Saved coach notes for this exercise (GYM-22 read side) — includes
 * general notes (exercise_id is null), which apply to every exercise in
 * the same plan. Scoped to planId too: a note made under one plan must
 * not keep applying after that plan is archived and replaced.
 */
export async function notesForExercise(
  db: SupabaseClient,
  userId: string,
  planId: string,
  exerciseId: string,
): Promise<string[]> {
  const { data } = await db
    .from("coach_notes")
    .select("note")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .or(`exercise_id.eq.${exerciseId},exercise_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []).map((r) => r.note as string);
}

/**
 * Dynamic session orchestration (System Design §20) support helpers.
 */

type ExerciseRow = Record<string, unknown> & { id: string; order_index: number };
type DeferredRow = { exercise_id: string; created_at: string; reason: string | null; interrupted: boolean };

/** Plan exercises visible to this session: real plan rows + this session's own adhoc substitutions. */
async function orderedExercisesForSession(
  db: SupabaseClient,
  planId: string,
  sessionId: string,
): Promise<ExerciseRow[]> {
  const { data } = await db
    .from("exercises")
    .select("*")
    .eq("plan_id", planId)
    .or(`source.eq.plan,session_id.eq.${sessionId}`)
    .order("order_index", { ascending: true });
  return (data ?? []) as ExerciseRow[];
}

/** Which exercises this session has ANY set_logs for (§20 rule: any nonzero count = attempted, never re-offered), and the pending-defer pool, oldest first. */
async function sessionExerciseState(
  db: SupabaseClient,
  sessionId: string,
): Promise<{ attemptedIds: Set<string>; deferred: DeferredRow[] }> {
  const [{ data: logRows }, { data: skipRows }] = await Promise.all([
    db.from("set_logs").select("exercise_id").eq("session_id", sessionId),
    db.from("session_exercise_skips").select("exercise_id, created_at, reason, interrupted")
      .eq("session_id", sessionId).order("created_at", { ascending: true }),
  ]);
  const attemptedIds = new Set<string>((logRows ?? []).map((r) => r.exercise_id as string));
  return { attemptedIds, deferred: (skipRows ?? []) as DeferredRow[] };
}

/**
 * Deterministic default, in priority order:
 *  1. Interrupted exercises (set aside because the user explicitly asked
 *     for a DIFFERENT one instead, not because this one itself was
 *     declined) — most-recently-interrupted first. These jump the whole
 *     queue: "B can be done now" while D was current must not bury D
 *     behind a never-touched E once B is done.
 *  2. The first fresh (never-touched, never-deferred) exercise by plan
 *     order — the normal, unremarkable case.
 *  3. Naturally-deferred exercises (genuinely skipped, e.g. "this one's
 *     taken, moving on") — oldest first, only once nothing fresh is left.
 * Never depends on the current exercise's own position — a revisited
 * exercise must not make the scan restart from the wrong place.
 */
function pickDefaultNext(
  ordered: ExerciseRow[],
  attemptedIds: Set<string>,
  deferred: DeferredRow[],
  excludeId: string,
): ExerciseRow | null {
  const eligible = deferred.filter((d) => d.exercise_id !== excludeId);

  const interrupted = eligible
    .filter((d) => d.interrupted)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  for (const d of interrupted) {
    const row = ordered.find((e) => e.id === d.exercise_id);
    if (row) return row;
  }

  const deferredIds = new Set(deferred.map((d) => d.exercise_id));
  const fresh = ordered.find(
    (e) => e.id !== excludeId && !attemptedIds.has(e.id) && !deferredIds.has(e.id),
  );
  if (fresh) return fresh;

  for (const d of eligible) {
    if (d.interrupted) continue; // already tried above
    const row = ordered.find((e) => e.id === d.exercise_id);
    if (row) return row;
  }
  return null;
}

const EQUIPMENT_TYPES = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "other"];

function validateSubstitute(sub: unknown): {
  name: string; sets: number; repRange: string; restSec: number; equipmentType: string | null;
} | null {
  if (!sub || typeof sub !== "object") return null;
  const s = sub as Record<string, unknown>;
  if (typeof s.name !== "string" || s.name.length < 1 || s.name.length > 200) return null;
  if (typeof s.sets !== "number" || !Number.isInteger(s.sets) || s.sets < 1 || s.sets > 20) return null;
  if (typeof s.repRange !== "string" || s.repRange.length < 1 || s.repRange.length > 20) return null;
  if (typeof s.restSec !== "number" || !Number.isInteger(s.restSec) || s.restSec < 0 || s.restSec > 1800) return null;
  const equipmentType = s.equipmentType;
  if (equipmentType !== null && (typeof equipmentType !== "string" || !EQUIPMENT_TYPES.includes(equipmentType))) {
    return null;
  }
  return {
    name: s.name, sets: s.sets, repRange: s.repRange, restSec: s.restSec,
    equipmentType: equipmentType as string | null,
  };
}

/** Idempotent: a retried turn reusing the same substitution name must reuse the same row, never create a duplicate. */
async function findOrCreateAdhocExercise(
  db: SupabaseClient,
  planId: string,
  sessionId: string,
  sub: { name: string; sets: number; repRange: string; restSec: number; equipmentType: string | null },
): Promise<ExerciseRow | null> {
  const { data: existing } = await db
    .from("exercises")
    .select("*")
    .eq("plan_id", planId)
    .eq("session_id", sessionId)
    .eq("source", "session_adhoc")
    .ilike("name", sub.name)
    .maybeSingle();
  if (existing) return existing as ExerciseRow;

  const { data: maxRow } = await db
    .from("exercises")
    .select("order_index")
    .eq("plan_id", planId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const orderIndex = (Number(maxRow?.order_index) || 0) + 1;

  const { data: created, error } = await db
    .from("exercises")
    .insert({
      plan_id: planId,
      session_id: sessionId,
      source: "session_adhoc",
      order_index: orderIndex,
      name: sub.name,
      sets: sub.sets,
      rep_range: sub.repRange,
      rest_sec: sub.restSec,
      intensity: "moderate",
      warmup: null,
      equipment_type: sub.equipmentType,
    })
    .select("*")
    .single();
  if (error) {
    console.error("adhoc exercise insert failed", { planId, sessionId, error: error.message });
    return null;
  }
  return created as ExerciseRow;
}

/**
 * Upsert, not insert: a retried /coach-turn must not double-defer the same
 * exercise. `interrupted` always reflects THIS defer's own circumstance
 * (was it set aside because of an explicit switch elsewhere, or genuinely
 * declined) — re-deferring an exercise updates its priority to match
 * why it's being set aside this time, not the first time.
 */
async function upsertDefer(
  db: SupabaseClient,
  sessionId: string,
  exerciseId: string,
  reason: string | null,
  interrupted: boolean,
): Promise<void> {
  const { error } = await db
    .from("session_exercise_skips")
    .upsert(
      { session_id: sessionId, exercise_id: exerciseId, reason, interrupted },
      { onConflict: "session_id,exercise_id" },
    );
  if (error) console.error("session_exercise_skips upsert failed", { sessionId, exerciseId, error: error.message });
}

async function resolveDefer(db: SupabaseClient, sessionId: string, exerciseId: string): Promise<void> {
  const { error } = await db
    .from("session_exercise_skips")
    .delete()
    .eq("session_id", sessionId)
    .eq("exercise_id", exerciseId);
  if (error) console.error("session_exercise_skips delete failed", { sessionId, exerciseId, error: error.message });
}

/** §20 progress: plan-slot-based, clamped so a substitution can never push it past total. */
function computeProgress(
  ordered: ExerciseRow[],
  attemptedIds: Set<string>,
): { done: number; total: number } {
  const total = ordered.filter((e) => e.source !== "session_adhoc").length;
  const done = ordered.filter((e) => attemptedIds.has(e.id)).length;
  return { done: Math.min(done, total), total };
}

/**
 * Free-text mid-workout turn (GYM-61/67), used by coach-turn once a
 * session is running: interpret what the user said about `exercise`
 * (report of completed sets, or something else), persist any sets the
 * agent extracted, and — if the exercise is now done — hand back the id
 * of the next exercise (or signal the workout is complete).
 *
 * §20 (tool-calling revision): the agent no longer self-reports an
 * `advance` flag — it's derived here from the real tool calls it made
 * (full completion, an explicit early stop, a defer, or a switch/
 * substitute), which is what makes this immune to the message/state
 * desync bug the original single-JSON-blob design shipped. The model may
 * also defer the current exercise, reorder to a different fresh/deferred
 * one, or substitute a movement outside the plan — but only ever in
 * reaction to what the user's message actually asked for (the stability
 * rule in buildConversationPrompt); this function's job is validating
 * that choice against real DB state before trusting it, never trusting
 * it outright.
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
  const exerciseId = exercise.id as string;

  const [{ data: profileRow }, ordered, { attemptedIds, deferred }, thisSessionLogRows, lastOtherExerciseLog] = await Promise.all([
    db.from("coach_profiles").select("*").eq("user_id", userId).maybeSingle(),
    orderedExercisesForSession(db, planId, sessionId),
    sessionExerciseState(db, sessionId),
    db.from("set_logs").select("*").eq("session_id", sessionId).eq("exercise_id", exerciseId)
      .order("set_no", { ascending: true }).then((r) => r.data ?? []),
    // The exercise (if any) most recently logged this session other than
    // the current one — lets a user's correction reach back one exercise
    // even after the flow has already moved on (see correctPreviousExerciseSet).
    db.from("set_logs").select("exercise_id, created_at").eq("session_id", sessionId).neq("exercise_id", exerciseId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle().then((r) => r.data ?? null),
  ]);
  if (!profileRow) return { status: 409, body: { error: "no_coach_profile" } };

  const wasAttemptedBefore = attemptedIds.has(exerciseId);
  const defaultNext = pickDefaultNext(ordered, attemptedIds, deferred, exerciseId);
  const deferredIds = new Set(deferred.map((d) => d.exercise_id));
  const remainingCandidates = ordered.filter(
    (e) => e.id !== exerciseId && e.id !== defaultNext?.id && (!attemptedIds.has(e.id) || deferredIds.has(e.id)),
  );
  const previousExerciseRow = lastOtherExerciseLog
    ? ordered.find((e) => e.id === lastOtherExerciseLog.exercise_id) ?? null
    : null;

  const [lastLogs, notes, nextLastLogs, nextNotes, remainingExercises, previousExerciseLogRows] = await Promise.all([
    lastLogsForExercise(db, userId, exerciseId),
    notesForExercise(db, userId, planId, exerciseId),
    defaultNext ? lastLogsForExercise(db, userId, defaultNext.id) : Promise.resolve([]),
    defaultNext ? notesForExercise(db, userId, planId, defaultNext.id) : Promise.resolve([]),
    Promise.all(
      remainingCandidates.map(async (e) => ({
        exercise: exerciseToAgent(e),
        lastLogs: setLogsToAgent(await lastLogsForExercise(db, userId, e.id)),
        notes: await notesForExercise(db, userId, planId, e.id),
        deferred: deferredIds.has(e.id),
      })),
    ),
    previousExerciseRow
      ? db.from("set_logs").select("*").eq("session_id", sessionId).eq("exercise_id", previousExerciseRow.id)
          .order("set_no", { ascending: true }).then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);

  const agentRes = await callAgent(
    {
      profile: profileToAgent(profileRow),
      exercise: exerciseToAgent(exercise),
      lastLogs: setLogsToAgent(lastLogs),
      notes,
      userMessage,
      recentHistory,
      thisSessionLogs: setLogsToAgent(thisSessionLogRows),
      nextExercise: defaultNext ? exerciseToAgent(defaultNext) : null,
      nextLastLogs: setLogsToAgent(nextLastLogs),
      nextNotes,
      remainingExercises,
      previousExercise: previousExerciseRow ? exerciseToAgent(previousExerciseRow) : null,
      previousExerciseLogs: setLogsToAgent(previousExerciseLogRows),
    },
    "/converse",
  );
  if (!agentRes.ok) return { status: 503, body: { error: "coach_unavailable" } };

  const turn = await agentRes.json();
  await recordUsage(db, userId, turn.usage);

  // §20: resolve the ACTUAL next exercise BEFORE deciding whether the
  // current one is being deferred — an override happening this same turn
  // (a specific reorder/substitution) is what distinguishes "interrupted,
  // resume ASAP" from a plain "this one's taken, skip it" defer, so the
  // defer write below needs to already know which kind it is.
  let nextRow: ExerciseRow | null = defaultNext;
  let usedOverride = false;

  const sub = validateSubstitute(turn.substituteExercise);
  if (sub) {
    const created = await findOrCreateAdhocExercise(db, planId, sessionId, sub);
    if (created) {
      nextRow = created;
      usedOverride = true;
    }
  } else if (typeof turn.switchToExerciseId === "string") {
    const picked = ordered.find(
      (e) => e.id === turn.switchToExerciseId && e.id !== exerciseId &&
        (!attemptedIds.has(e.id) || deferredIds.has(e.id)),
    );
    if (picked) {
      nextRow = picked;
      usedOverride = true;
    }
  }

  // New sets this turn are logged incrementally (offset by what's already
  // recorded this session) — a partial report now persists immediately
  // instead of waiting for the exercise to be fully accounted for.
  const newSets: Array<{ weightKg: number; reps: number }> = Array.isArray(turn.loggedSets) ? turn.loggedSets : [];
  if (newSets.length > 0) {
    const rows = newSets.map((s, i) => ({
      session_id: sessionId,
      exercise_id: exerciseId,
      set_no: thisSessionLogRows.length + i + 1,
      weight_kg: s.weightKg,
      reps: s.reps,
    }));
    const { error } = await db
      .from("set_logs")
      .upsert(rows, { onConflict: "session_id,exercise_id,set_no" });
    if (error) {
      console.error("set_logs upsert failed", { userId, sessionId, error: error.message });
    }
  }

  // A fix to a set already logged this session (not a new report) —
  // re-validate the setNo against the real rows fetched above before
  // trusting it, same "never trust twice" discipline as everything else
  // here. Reuses the same upsert-by-conflict-key the append path above
  // uses; the difference is this setNo already exists, so it updates the
  // real row in place instead of appending a new one.
  if (turn.correctedSet && Number.isInteger(turn.correctedSet.setNo)) {
    const target = thisSessionLogRows.find((r) => r.set_no === turn.correctedSet.setNo);
    if (target) {
      const { error } = await db.from("set_logs").upsert({
        session_id: sessionId,
        exercise_id: exerciseId,
        set_no: turn.correctedSet.setNo,
        weight_kg: turn.correctedSet.weightKg ?? target.weight_kg,
        reps: turn.correctedSet.reps ?? target.reps,
      }, { onConflict: "session_id,exercise_id,set_no" });
      if (error) {
        console.error("set_logs correction failed", { userId, sessionId, error: error.message });
      }
    } else {
      // Shouldn't happen — the tool already checks this against the same
      // data — but the agent's word alone is never enough to write.
      console.error("correctLoggedSet: setNo not found in this session's logs", {
        userId, sessionId, exerciseId, setNo: turn.correctedSet.setNo,
      });
    }
  }

  // Same idea as correctedSet above, but targeting the PREVIOUS exercise
  // logged this session — re-validated against previousExerciseRow/
  // previousExerciseLogRows fetched at the top of this function, never
  // trusting the agent's exerciseId/setNo claim outright.
  if (
    turn.correctedPreviousExerciseSet && previousExerciseRow &&
    turn.correctedPreviousExerciseSet.exerciseId === previousExerciseRow.id &&
    Number.isInteger(turn.correctedPreviousExerciseSet.setNo)
  ) {
    const target = previousExerciseLogRows.find((r) => r.set_no === turn.correctedPreviousExerciseSet.setNo);
    if (target) {
      const { error } = await db.from("set_logs").upsert({
        session_id: sessionId,
        exercise_id: previousExerciseRow.id,
        set_no: turn.correctedPreviousExerciseSet.setNo,
        weight_kg: turn.correctedPreviousExerciseSet.weightKg ?? target.weight_kg,
        reps: turn.correctedPreviousExerciseSet.reps ?? target.reps,
      }, { onConflict: "session_id,exercise_id,set_no" });
      if (error) {
        console.error("set_logs previous-exercise correction failed", { userId, sessionId, error: error.message });
      }
    } else {
      console.error("correctPreviousExerciseSet: setNo not found in previous exercise's logs", {
        userId, sessionId, exerciseId: previousExerciseRow.id, setNo: turn.correctedPreviousExerciseSet.setNo,
      });
    }
  }

  const totalLoggedThisSession = thisSessionLogRows.length + newSets.length;
  const nowAttempted = wasAttemptedBefore || newSets.length > 0;
  const fullyComplete = totalLoggedThisSession >= (exercise.sets as number);
  const advance = fullyComplete || !!turn.stoppedEarly || !!turn.deferred || usedOverride;

  if (nowAttempted) {
    // Real sets exist now (possibly from an earlier turn already) — this
    // resolves a revisit, and any prior deferral no longer applies.
    await resolveDefer(db, sessionId, exerciseId);
    attemptedIds.add(exerciseId); // so this turn's own progress reflects it immediately
  } else if (advance) {
    // §20: nothing ever logged this session for this exercise, and it's
    // being left — either a genuine defer (deferCurrentExercise) or an
    // interrupt (a switch/substitute happened instead). `usedOverride`
    // marks which: see pickDefaultNext's priority rule.
    await upsertDefer(db, sessionId, exerciseId, turn.deferReason ?? turn.stopReason ?? null, usedOverride);
  }

  // Notes surfaced naturally in conversation (GYM feedback): the LLM
  // extracts these the same way it extracts a set report — no separate
  // UI action from the user, just talking to the coach like a trainer.
  if (
    turn.noteToSave && typeof turn.noteToSave.text === "string" &&
    turn.noteToSave.text.length > 0 && turn.noteToSave.text.length <= 500
  ) {
    const { error } = await db.from("coach_notes").insert({
      user_id: userId,
      plan_id: planId,
      exercise_id: turn.noteToSave.general ? null : exerciseId,
      note: turn.noteToSave.text,
    });
    if (error) {
      console.error("coach_notes insert failed", { userId, sessionId, error: error.message });
    }
  }

  // A fix to the wording of the most-recently-saved note for this
  // exercise — the agent has no note ids to reference (deliberately kept
  // out of its context), so "which note" is resolved here: the latest
  // one for this exercise, the only sane default for a same-turn
  // "actually, make that..." correction. A general (not exercise-scoped)
  // note isn't covered by this — out of scope for now.
  if (
    turn.correctedNote && typeof turn.correctedNote.newText === "string" &&
    turn.correctedNote.newText.length > 0 && turn.correctedNote.newText.length <= 500
  ) {
    const { data: recentNote } = await db.from("coach_notes")
      .select("id")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentNote) {
      const { error } = await db.from("coach_notes")
        .update({ note: turn.correctedNote.newText })
        .eq("id", recentNote.id);
      if (error) {
        console.error("coach_notes correction failed", { userId, sessionId, error: error.message });
      }
    }
  }

  if (!advance) {
    return {
      status: 200,
      body: {
        message: turn.message,
        advance: false,
        nextExerciseId: exerciseId,
        nextExerciseName: exercise.name as string,
        sessionComplete: false,
        degraded: !!turn.degraded,
        nextSuggestedWeightKg: turn.nextSuggestedWeightKg ?? null,
        nextTargetReps: turn.nextTargetReps ?? null,
        progress: computeProgress(ordered, attemptedIds),
      },
    };
  }

  // The agent already composed one unified reply covering whichever
  // exercise is actually next (default, switched, or substituted) — no
  // second HTTP round trip needed here, unlike the pre-tool-calling design.
  return {
    status: 200,
    body: {
      message: turn.message,
      advance: true,
      nextExerciseId: nextRow?.id ?? null,
      nextExerciseName: nextRow?.name ?? null,
      sessionComplete: !nextRow,
      degraded: !!turn.degraded,
      nextSuggestedWeightKg: turn.nextSuggestedWeightKg ?? null,
      nextTargetReps: turn.nextTargetReps ?? null,
      progress: computeProgress(ordered, attemptedIds),
    },
  };
}

/**
 * Generative-UI confirm action (System Design §19, revised): the sets
 * are already final (confirmed via button, not typed) — nothing here is
 * extracted or decided by the model. But per direct feedback, a canned
 * template read as a noticeably worse reply than the LLM-composed one
 * free text gets, so this still calls the agent — just to compose the
 * reply text and the next exercise's intro, never to pick the numbers.
 */
export async function confirmExerciseSets(
  db: SupabaseClient,
  params: {
    userId: string;
    sessionId: string;
    planId: string;
    exercise: Record<string, unknown>;
    confirmedSets: Array<{ weightKg: number; reps: number }>;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { userId, sessionId, planId, exercise, confirmedSets } = params;
  const exerciseId = exercise.id as string;

  const [{ data: profileRow }, ordered, { attemptedIds, deferred }] = await Promise.all([
    db.from("coach_profiles").select("*").eq("user_id", userId).maybeSingle(),
    orderedExercisesForSession(db, planId, sessionId),
    sessionExerciseState(db, sessionId),
  ]);
  if (!profileRow) return { status: 409, body: { error: "no_coach_profile" } };

  const rows = confirmedSets.map((s, i) => ({
    session_id: sessionId,
    exercise_id: exerciseId,
    set_no: i + 1,
    weight_kg: s.weightKg,
    reps: s.reps,
  }));
  const { error } = await db
    .from("set_logs")
    .upsert(rows, { onConflict: "session_id,exercise_id,set_no" });
  if (error) {
    console.error("set_logs upsert failed (confirm)", { userId, sessionId, error: error.message });
    return { status: 500, body: { error: "write_failed" } };
  }
  // §20: real sets now exist for this exercise — resolves a revisit, and
  // makes progress/next-exercise selection reflect it immediately.
  await resolveDefer(db, sessionId, exerciseId);
  attemptedIds.add(exerciseId);

  // No free text on this path — "next" is always the deterministic pick,
  // same fresh-first-else-earliest-deferred rule the free-text path falls
  // back to, just with no override possible here.
  const nextRow = pickDefaultNext(ordered, attemptedIds, deferred, exerciseId);
  const isRevisit = nextRow ? deferred.some((d) => d.exercise_id === nextRow.id) : false;

  const [notes, nextLastLogs, nextNotes] = await Promise.all([
    notesForExercise(db, userId, planId, exerciseId),
    nextRow ? lastLogsForExercise(db, userId, nextRow.id) : Promise.resolve([]),
    nextRow ? notesForExercise(db, userId, planId, nextRow.id) : Promise.resolve([]),
  ]);

  const agentRes = await callAgent(
    {
      profile: profileToAgent(profileRow),
      exercise: exerciseToAgent(exercise),
      confirmedSets,
      notes,
      nextExercise: nextRow ? exerciseToAgent(nextRow) : null,
      nextLastLogs: setLogsToAgent(nextLastLogs),
      nextNotes,
      isRevisit,
    },
    "/confirm-turn",
  );
  if (!agentRes.ok) return { status: 503, body: { error: "coach_unavailable" } };

  const turn = await agentRes.json();
  await recordUsage(db, userId, turn.usage);

  return {
    status: 200,
    body: {
      message: turn.message,
      advance: true,
      nextExerciseId: nextRow?.id ?? null,
      nextExerciseName: nextRow?.name ?? null,
      sessionComplete: !nextRow,
      degraded: !!turn.degraded,
      nextSuggestedWeightKg: turn.nextSuggestedWeightKg ?? null,
      nextTargetReps: turn.nextTargetReps ?? null,
      progress: computeProgress(ordered, attemptedIds),
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
      notesForExercise(db, userId, planId, exercise.id as string),
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
