// Tests for the Stage A write tools (NH-44). The SQL behind them is tested
// against Postgres separately; these cover the TypeScript side: arguments
// passed through, refusals mapped, summaries built from the data.
// Run: deno test --no-config supabase/functions/
import { assert, assertEquals, assertInstanceOf, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handleMcp, ToolError } from "../_shared/mcp.ts";
import { TOOLS, type ToolContext } from "./tools.ts";
import { describeChange, REFUSALS, summarizeUndo, WRITE_TOOLS } from "./write-tools.ts";

const USER = "22222222-2222-4222-8222-222222222222";
const EX = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444";

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
function ctxWith(result: RpcResult) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const ctx: ToolContext = {
    db: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve(result);
      },
    } as unknown as SupabaseClient,
    userId: USER,
    now: () => new Date("2026-10-10T12:00:00Z"),
  };
  return { ctx, calls };
}
const tool = (name: string) => WRITE_TOOLS.find((t) => t.name === name)!;

const BEFORE = { exercise_id: EX, plan_id: PLAN, name: "Bench Press", sets: 3, rep_range: "6-10", rest_sec: 120, intensity: "RIR 1-2", warmup: null };
const AFTER = { ...BEFORE, sets: 4, rep_range: "8-12", rest_sec: 90 };

// ------------------------------------------------------------ save_note

Deno.test("save_note: the user comes from the token, the ids from the arguments", async () => {
  const { ctx, calls } = ctxWith({
    data: { action_id: "a1", note_id: "n1", plan_id: PLAN, plan_name: "Upper", exercise_id: EX, exercise_name: "Bench Press", text: "Pause the first rep", duplicate: false },
    error: null,
  });
  const r = await tool("save_note").handler({ text: "Pause the first rep", exercise_id: EX }, ctx) as Record<string, unknown>;
  assertEquals(calls, [{ fn: "assistant_save_note", args: { p_user_id: USER, p_plan_id: null, p_exercise_id: EX, p_text: "Pause the first rep" } }]);
  assertEquals(r.summary, 'Saved a note for Bench Press (Upper): "Pause the first rep". It can be undone with undo_last_change for 24 hours.');
});

Deno.test("save_note: a general note names the plan; a retry says nothing new was added", async () => {
  const general = ctxWith({ data: { plan_name: "Upper", exercise_name: null, text: "Keep rest honest", duplicate: false }, error: null });
  assertStringIncludes((await tool("save_note").handler({ text: "Keep rest honest", plan_id: PLAN }, general.ctx) as { summary: string }).summary, "the Upper plan");
  const dup = ctxWith({ data: { plan_name: "Upper", exercise_name: "Bench Press", text: "x", duplicate: true }, error: null });
  assertStringIncludes((await tool("save_note").handler({ text: "x", exercise_id: EX }, dup.ctx) as { summary: string }).summary, "nothing new was added");
});

Deno.test("save_note: needs an exercise or a plan, and asks for one without calling the database", async () => {
  const { ctx, calls } = ctxWith({ data: null, error: null });
  await assertRejects(() => tool("save_note").handler({ text: "x" }, ctx), ToolError);
  assertEquals(calls.length, 0);
});

// ------------------------------------------------------------ adjust_plan_exercise

Deno.test("adjust_plan_exercise: passes only the changes, and summarizes exactly what changed", async () => {
  const { ctx, calls } = ctxWith({ data: { action_id: "a2", before: BEFORE, after: AFTER }, error: null });
  const r = await tool("adjust_plan_exercise").handler({ exercise_id: EX, sets: 4, rep_range: "8-12", rest_sec: 90 }, ctx) as Record<string, unknown>;
  assertEquals(calls[0], {
    fn: "assistant_adjust_exercise",
    args: { p_user_id: USER, p_exercise_id: EX, p_changes: { sets: 4, rep_range: "8-12", rest_sec: 90 } },
  });
  assertEquals(
    r.summary,
    "Changed Bench Press: sets 3 → 4; rep range 6-10 → 8-12; rest 120 s → 90 s. It can be undone with undo_last_change for 24 hours.",
  );
});

Deno.test("adjust_plan_exercise: no changes is refused without calling the database", async () => {
  const { ctx, calls } = ctxWith({ data: null, error: null });
  const e = await assertRejects(() => tool("adjust_plan_exercise").handler({ exercise_id: EX }, ctx), ToolError);
  assertEquals(e.message, REFUSALS.nothing_to_change);
  assertEquals(calls.length, 0);
});

// ------------------------------------------------------------ refusals

Deno.test("refusals from the database become messages the agent can act on", async () => {
  for (const code of Object.keys(REFUSALS)) {
    const { ctx } = ctxWith({ data: null, error: { code: "P0001", message: code } });
    const e = await assertRejects(() => tool("undo_last_change").handler({}, ctx), ToolError);
    assertEquals(e.message, REFUSALS[code]);
  }
});

Deno.test("an unknown database error is not passed to the agent as a refusal", async () => {
  for (const error of [{ code: "P0001", message: "something_new" }, { code: "42501", message: "permission denied for function" }]) {
    const { ctx } = ctxWith({ data: null, error });
    const e = await assertRejects(() => tool("undo_last_change").handler({}, ctx));
    assert(!(e instanceof ToolError), JSON.stringify(error));
    assertInstanceOf(e, Error);
  }
});

// ------------------------------------------------------------ undo

Deno.test("undo: summaries run from after back to before", () => {
  assertEquals(summarizeUndo({ kind: "adjust_plan_exercise", before: BEFORE, after: AFTER }), "Reverted Bench Press: sets 4 → 3; rep range 8-12 → 6-10; rest 90 s → 120 s.");
  assertEquals(summarizeUndo({ kind: "save_note", after: { text: "Pause the first rep" } }), 'Removed the note "Pause the first rep".');
});

Deno.test("describeChange: only differing fields; a cleared warm-up reads as none", () => {
  assertEquals(describeChange(BEFORE, BEFORE), "");
  assertEquals(describeChange({ ...BEFORE, warmup: "2 light sets" }, BEFORE), "warm-up 2 light sets → none");
});

// ------------------------------------------------------------ registry

Deno.test("the tool list: unique names, strict schemas, no user id argument, writes flagged", () => {
  const names = TOOLS.map((t) => t.name);
  assertEquals(new Set(names).size, names.length);
  for (const t of TOOLS) {
    assertEquals(t.inputSchema.additionalProperties, false, t.name);
    assert(!Object.keys(t.inputSchema.properties ?? {}).some((k) => k.includes("user")), t.name);
  }
  for (const t of WRITE_TOOLS) assertEquals(t.readOnly, false, t.name);
  assertEquals(names, ["notch_ping", "get_profile", "get_active_plans", "get_workout_history", "get_user_facts", "save_note", "adjust_plan_exercise", "undo_last_change"]);
});

Deno.test("through the MCP core: a bad rep range never reaches the database", async () => {
  const { ctx, calls } = ctxWith({ data: null, error: null });
  const server = { name: "notch-tools", version: "0", tools: TOOLS };
  // deno-lint-ignore no-explicit-any
  const r: any = await handleMcp(server, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "adjust_plan_exercise", arguments: { exercise_id: EX, rep_range: "eight to twelve" } },
  }, ctx);
  assert(r.result.isError);
  assertStringIncludes(r.result.content[0].text, "at most 7 characters");
  assertEquals(calls.length, 0);
});
