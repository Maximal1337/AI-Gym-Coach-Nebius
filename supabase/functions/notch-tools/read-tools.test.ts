// Tests for the Stage A read tools (NH-43). Run: deno test --no-config supabase/functions/
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { formatFacts, formatPlans, formatProfile, READ_TOOLS, summarizeHistory, weightIn } from "./read-tools.ts";
import type { ToolContext } from "./tools.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-10T12:00:00Z");

/**
 * A stand-in for the Supabase query builder: records every chained call per
 * table and resolves to canned rows, so tests can assert how each table was
 * filtered without a database.
 */
function recordingDb(tables: Record<string, unknown>) {
  const queries: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
  const from = (table: string) => {
    const query = { table, calls: [] as Array<[string, unknown[]]> };
    queries.push(query);
    const builder: Record<string | symbol, unknown> = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          const rows = tables[table] ?? [];
          const single = query.calls.some(([m]) => m === "maybeSingle");
          const data = single ? (Array.isArray(rows) ? rows[0] ?? null : rows) : rows;
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve({ data, error: null }).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          query.calls.push([String(prop), args]);
          return builder;
        };
      },
    });
    return builder;
  };
  const ctx: ToolContext = { db: { from } as unknown as SupabaseClient, userId: USER, now: () => NOW };
  return { ctx, queries };
}

const USER_OWNED = ["coach_profiles", "fitness_profiles", "training_plans", "coach_notes", "workout_sessions", "studio_sessions", "user_facts"];

function assertScopedToUser(queries: Array<{ table: string; calls: Array<[string, unknown[]]> }>) {
  for (const q of queries) {
    if (USER_OWNED.includes(q.table)) {
      assert(
        q.calls.some(([m, args]) => m === "eq" && args[0] === "user_id" && args[1] === USER),
        `${q.table} query is not filtered by user_id: ${JSON.stringify(q.calls)}`,
      );
    } else if (q.table === "set_logs") {
      assert(q.calls.some(([m, args]) => m === "in" && args[0] === "session_id"), "set_logs must be read by session ids");
    } else {
      throw new Error(`unexpected table ${q.table}`);
    }
  }
}

const tool = (name: string) => READ_TOOLS.find((t) => t.name === name)!;

const SESSIONS = [
  { id: "s2", started_at: "2026-10-08T17:00:00Z", status: "completed", training_plans: { name: "Upper" } },
  { id: "s1", started_at: "2026-10-01T17:00:00Z", status: "completed", training_plans: { name: "Upper" } },
];
const LOGS = [
  { session_id: "s1", exercise_id: "bench", set_no: 2, weight_kg: 60, reps: 8, exercises: { name: "Bench Press", order_index: 1 } },
  { session_id: "s1", exercise_id: "bench", set_no: 1, weight_kg: 60, reps: 10, exercises: { name: "Bench Press", order_index: 1 } },
  { session_id: "s1", exercise_id: "row", set_no: 1, weight_kg: 50, reps: 10, exercises: { name: "Cable Row", order_index: 2 } },
  { session_id: "s2", exercise_id: "bench", set_no: 1, weight_kg: 62.5, reps: 8, exercises: { name: "Bench Press", order_index: 1 } },
  { session_id: "s2", exercise_id: "bench", set_no: 2, weight_kg: 62.5, reps: 9, exercises: { name: "Bench Press", order_index: 1 } },
];

// ------------------------------------------------------------ scoping

Deno.test("every read tool filters every query by the caller's user id", async () => {
  const { ctx, queries } = recordingDb({
    coach_profiles: [{ units: "metric" }],
    fitness_profiles: [],
    training_plans: [{ id: "p1", name: "Upper", exercises: [] }],
    coach_notes: [],
    workout_sessions: SESSIONS,
    set_logs: LOGS,
    studio_sessions: [],
    user_facts: [],
  });
  for (const t of READ_TOOLS) await t.handler({}, ctx);
  assertScopedToUser(queries);
  assertEquals(new Set(queries.map((q) => q.table)).size, 8, "all tables were exercised");
});

Deno.test("no tool accepts a user id argument", () => {
  for (const t of READ_TOOLS) {
    assertEquals(t.inputSchema.additionalProperties, false, t.name);
    assert(!Object.keys(t.inputSchema.properties ?? {}).some((k) => k.includes("user")), t.name);
    assert(t.readOnly, t.name);
  }
});

// ------------------------------------------------------------ units

Deno.test("weights: rounded to 0.5 in the user's units, like the app", () => {
  assertEquals(weightIn(62.5, "metric"), 62.5);
  assertEquals(weightIn(62.3, "metric"), 62.5);
  assertEquals(weightIn(100, "imperial"), 220.5);
  assertEquals(weightIn(20, "imperial"), 44);
});

// ------------------------------------------------------------ get_profile

Deno.test("get_profile: imperial users get lb and inches", () => {
  const p = formatProfile(
    { coach_name: "Max", language: "en", tone_preset: "calm_precise", accountability_style: "gentle" },
    { primary_goal: "strength", experience_level: "intermediate", days_per_week: 4, age: 31, weight_kg: "80.0", height_cm: "180.0", injury_notes: "Left knee" },
    "imperial",
  );
  assertEquals(p.units, "lb");
  assertEquals(p.fitness?.body_weight, 176.5);
  assertEquals(p.fitness?.height, { value: 70.9, unit: "in" });
  assertEquals(p.fitness?.injury_notes, "Left knee");
});

Deno.test("get_profile: missing rows read as null, not as errors", () => {
  assertEquals(formatProfile(null, null, "metric"), { units: "kg", coach: null, fitness: null });
});

Deno.test("get_profile handler: units come from the coach profile", async () => {
  const { ctx } = recordingDb({ coach_profiles: [{ coach_name: "C", units: "imperial" }], fitness_profiles: [{ weight_kg: 100 }] });
  const r = await tool("get_profile").handler({}, ctx) as ReturnType<typeof formatProfile>;
  assertEquals(r.units, "lb");
  assertEquals(r.fitness?.body_weight, 220.5);
});

// ------------------------------------------------------------ get_active_plans

Deno.test("get_active_plans: plan exercises in order, session substitutes left out, notes per plan", () => {
  const plans = formatPlans(
    [{
      id: "p1",
      name: "Upper",
      exercises: [
        { id: "e2", order_index: 2, name: "Row", sets: 3, rep_range: "8-12", rest_sec: 90, intensity: "RIR 2", source: "plan" },
        { id: "e9", order_index: 3, name: "Adhoc swap", sets: 3, rep_range: "8-12", rest_sec: 90, intensity: "RIR 2", source: "session_adhoc" },
        { id: "e1", order_index: 1, name: "Bench", sets: 3, rep_range: "6-10", rest_sec: 120, intensity: "RIR 1", source: "plan", equipment_type: "barbell" },
      ],
    }],
    [
      { plan_id: "p1", note: "Pause the first rep", exercise_id: "e1" },
      { plan_id: "p2", note: "Other plan", exercise_id: null },
      { plan_id: "p1", note: "Keep rest honest", exercise_id: null },
    ],
  );
  assertEquals(plans[0].exercises.map((e) => e.id), ["e1", "e2"]);
  assertEquals(plans[0].exercises[0].equipment, "barbell");
  assertEquals(plans[0].notes, [{ text: "Pause the first rep", exercise_id: "e1" }, { text: "Keep rest honest", exercise_id: null }]);
});

Deno.test("get_active_plans handler: no active plan skips the notes query", async () => {
  const { ctx, queries } = recordingDb({ training_plans: [] });
  assertEquals(await tool("get_active_plans").handler({}, ctx), { plans: [] });
  assertEquals(queries.map((q) => q.table), ["training_plans"]);
  assert(queries[0].calls.some(([m, a]) => m === "eq" && a[0] === "status" && a[1] === "active"));
});

// ------------------------------------------------------------ get_workout_history

Deno.test("history: sessions newest first, sets in order, progression computed in code", () => {
  const h = summarizeHistory(SESSIONS, LOGS, [], "metric", new Date("2026-09-12T12:00:00Z"));
  assertEquals(h.sessions.map((s) => s.id), ["s2", "s1"]);
  assertEquals(h.sessions[1].exercises.map((e) => e.name), ["Bench Press", "Cable Row"]);
  assertEquals(h.sessions[1].exercises[0].sets, [{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }]);
  const bench = h.progress.find((p) => p.exercise === "Bench Press")!;
  assertEquals(bench.sessions, 2);
  // Top set: heaviest, ties broken by reps.
  assertEquals(bench.first_top_set, { weight: 60, reps: 10, date: "2026-10-01T17:00:00Z" });
  assertEquals(bench.last_top_set, { weight: 62.5, reps: 9, date: "2026-10-08T17:00:00Z" });
  assertEquals(bench.weight_change, 2.5);
  assertEquals(h.progress.find((p) => p.exercise === "Cable Row")!.weight_change, 0);
});

Deno.test("history: imperial units apply to sets and progression", () => {
  const h = summarizeHistory(SESSIONS, LOGS, [], "imperial", NOW);
  assertEquals(h.units, "lb");
  assertEquals(h.sessions[1].exercises[0].sets[0].weight, 132.5);
  assertEquals(h.progress.find((p) => p.exercise === "Bench Press")!.weight_change, 5.5);
});

Deno.test("history handler: the window follows `days`, and no sessions means no set_logs query", async () => {
  const { ctx, queries } = recordingDb({ coach_profiles: [{ units: "metric" }], workout_sessions: [], studio_sessions: [] });
  const r = await tool("get_workout_history").handler({ days: 7 }, ctx) as ReturnType<typeof summarizeHistory>;
  assertEquals(r.since, "2026-10-03T12:00:00.000Z");
  assert(!queries.some((q) => q.table === "set_logs"));
  const sessionsQuery = queries.find((q) => q.table === "workout_sessions")!;
  assert(sessionsQuery.calls.some(([m, a]) => m === "gte" && a[0] === "started_at" && a[1] === "2026-10-03T12:00:00.000Z"));
});

Deno.test("history handler: defaults to 28 days", async () => {
  const { ctx } = recordingDb({ coach_profiles: [], workout_sessions: [], studio_sessions: [] });
  const r = await tool("get_workout_history").handler({}, ctx) as ReturnType<typeof summarizeHistory>;
  assertEquals(r.since, "2026-09-12T12:00:00.000Z");
});

Deno.test("history: studio classes are listed briefly", () => {
  const h = summarizeHistory([], [], [{ name: "Murph", started_at: "2026-10-05T08:00:00Z", score_type: "fortime" }], "metric", NOW);
  assertEquals(h.studio_sessions, [{ name: "Murph", date: "2026-10-05T08:00:00Z", score_type: "fortime" }]);
});

// ------------------------------------------------------------ get_user_facts

Deno.test("get_user_facts: text, category, pin and last seen — nothing else", () => {
  const facts = formatFacts([
    { doc: { text: "Left knee pain on deep squats", category: "health", last_seen_at: "2026-10-01T00:00:00Z", source_message_ids: ["m1"] }, pinned: true, score: 1.2 },
  ]);
  assertEquals(facts, [{ text: "Left knee pain on deep squats", category: "health", pinned: true, last_seen: "2026-10-01T00:00:00Z" }]);
});
