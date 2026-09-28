import { type ToolDefinition, ToolError } from "../_shared/mcp.ts";
import type { ToolContext } from "./tools.ts";

/**
 * Stage A write tools (NH-44, D-22): save a note, change one exercise's
 * parameters in one active plan, undo. The assistant acts without an "are you
 * sure?" round trip, so safety comes from three things instead:
 *  - a narrow scope — never swapping the movement itself (see migration
 *    20260928140000_assistant_write_tools.sql for why);
 *  - an audit trail — each write and its assistant_actions row are one
 *    database function, so they commit or fail together;
 *  - undo for 24 hours.
 * Each result carries a `summary` built here from the before/after state, so
 * the reply can say exactly what changed without the model paraphrasing
 * numbers.
 */

type Json = Record<string, unknown>;

const UNDO_HINT = "It can be undone with undo_last_change for 24 hours.";

/** Refusal codes raised by the SQL functions (SQLSTATE P0001), as messages the agent can act on. */
export const REFUSALS: Record<string, string> = {
  plan_not_found: "That plan isn't one of the user's active plans. Take plan ids from get_active_plans.",
  exercise_not_found:
    "That exercise isn't in one of the user's active plans (a one-off substitute from a workout doesn't count). " +
    "Take exercise ids from get_active_plans.",
  workout_in_progress: "The user is in the middle of that workout. Plan changes have to wait until they finish it.",
  invalid_input:
    "Those values aren't allowed. Sets 1–20, rep range like 8-12 or 10, rest 0–1800 seconds, intensity up to 60 " +
    "characters, warm-up up to 200 (empty clears it), notes 1–500 characters. The exercise can't be swapped for " +
    "another movement — suggest that the user changes it in the app.",
  nothing_to_change: "Nothing would change: the exercise already has those values.",
  nothing_to_undo: "There's nothing from the last 24 hours left to undo.",
  undo_conflict:
    "That change can't be undone automatically, because the exercise has changed since. Tell the user what the " +
    "change was and let them decide.",
};

/** Calls a write function; known refusals become ToolErrors, anything else is an unexpected failure. */
async function callWrite(ctx: ToolContext, fn: string, args: Json): Promise<Json> {
  const { data, error } = await ctx.db.rpc(fn, args);
  if (error) {
    const refusal = error.code === "P0001" ? REFUSALS[error.message] : undefined;
    if (refusal) throw new ToolError(refusal);
    throw new Error(`${fn}: ${error.message}`);
  }
  return data as Json;
}

const FIELD_LABELS: Record<string, string> = {
  sets: "sets",
  rep_range: "rep range",
  rest_sec: "rest",
  intensity: "intensity",
  warmup: "warm-up",
};

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (field === "rest_sec") return `${value} s`;
  return String(value);
}

/** "sets 3 → 4; rep range 6-10 → 8-12" — only the fields that differ. */
export function describeChange(from: Json, to: Json): string {
  return Object.keys(FIELD_LABELS)
    .filter((f) => (from[f] ?? null) !== (to[f] ?? null))
    .map((f) => `${FIELD_LABELS[f]} ${show(f, from[f])} → ${show(f, to[f])}`)
    .join("; ");
}

export function summarizeNote(r: Json): string {
  const where = r.exercise_name ? `${r.exercise_name} (${r.plan_name})` : `the ${r.plan_name} plan`;
  if (r.duplicate) return `That note was already saved for ${where} a moment ago; nothing new was added.`;
  return `Saved a note for ${where}: "${r.text}". ${UNDO_HINT}`;
}

export function summarizeAdjust(r: Json): string {
  const before = r.before as Json;
  const after = r.after as Json;
  return `Changed ${before.name}: ${describeChange(before, after)}. ${UNDO_HINT}`;
}

export function summarizeUndo(r: Json): string {
  if (r.kind === "save_note") return `Removed the note "${(r.after as Json).text}".`;
  const before = r.before as Json;
  const after = r.after as Json;
  return `Reverted ${before.name}: ${describeChange(after, before)}.`;
}

const saveNote: ToolDefinition<ToolContext> = {
  name: "save_note",
  title: "Save a coach note",
  description:
    "Saves a note the user wants the coach to remember during workouts — about one exercise (give exercise_id) or " +
    "general for a plan (give plan_id). Ids come from get_active_plans. Tell the user what was saved.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, maxLength: 500, description: "The note, in the user's language." },
      exercise_id: { type: "string", format: "uuid", description: "For a note about one exercise." },
      plan_id: { type: "string", format: "uuid", description: "For a general note on a plan." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  readOnly: false,
  handler: async (args, ctx) => {
    if (!args.exercise_id && !args.plan_id) {
      throw new ToolError("Give exercise_id for a note about one exercise, or plan_id for a general note on a plan.");
    }
    const r = await callWrite(ctx, "assistant_save_note", {
      p_user_id: ctx.userId,
      p_plan_id: args.plan_id ?? null,
      p_exercise_id: args.exercise_id ?? null,
      p_text: args.text,
    });
    return { ...r, summary: summarizeNote(r) };
  },
};

const adjustPlanExercise: ToolDefinition<ToolContext> = {
  name: "adjust_plan_exercise",
  title: "Change an exercise's parameters",
  description:
    "Changes one exercise in one of the user's active plans: sets, rep range, rest, intensity or warm-up. It can't " +
    "swap the exercise for another movement. Not possible while the user is training that workout. Tell the user " +
    "exactly what changed (the summary) and that it can be undone.",
  inputSchema: {
    type: "object",
    properties: {
      exercise_id: { type: "string", format: "uuid", description: "From get_active_plans." },
      sets: { type: "integer", minimum: 1, maximum: 20 },
      rep_range: { type: "string", minLength: 1, maxLength: 7, description: 'Like "8-12" or "10".' },
      rest_sec: { type: "integer", minimum: 0, maximum: 1800 },
      intensity: { type: "string", minLength: 1, maxLength: 60, description: 'Like "RIR 1-2" or "RPE 8".' },
      warmup: { type: "string", maxLength: 200, description: "Warm-up instructions; an empty string clears them." },
    },
    required: ["exercise_id"],
    additionalProperties: false,
  },
  readOnly: false,
  handler: async (args, ctx) => {
    const { exercise_id, ...changes } = args;
    if (Object.keys(changes).length === 0) throw new ToolError(REFUSALS.nothing_to_change);
    const r = await callWrite(ctx, "assistant_adjust_exercise", {
      p_user_id: ctx.userId,
      p_exercise_id: exercise_id,
      p_changes: changes,
    });
    return { ...r, summary: summarizeAdjust(r) };
  },
};

const undoLastChange: ToolDefinition<ToolContext> = {
  name: "undo_last_change",
  title: "Undo the last change",
  description:
    "Undoes the most recent change you made for the user in the last 24 hours (a saved note or an exercise change). " +
    "Calling it again undoes the one before. Tell the user what was undone.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  readOnly: false,
  handler: async (_args, ctx) => {
    const r = await callWrite(ctx, "assistant_undo_last", { p_user_id: ctx.userId });
    return { ...r, summary: summarizeUndo(r) };
  },
};

export const WRITE_TOOLS: readonly ToolDefinition<ToolContext>[] = [saveNote, adjustPlanExercise, undoLastChange];
