import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { Exercise, SetLog } from "@gymcoach/shared";
import { suggestTargets } from "./progression.js";
import { formatHistory } from "./prompt.js";
import {
  logCompletedSetsArgsSchema,
  stopExerciseEarlyArgsSchema,
  deferCurrentExerciseArgsSchema,
  switchToExerciseArgsSchema,
  substituteExerciseArgsSchema,
  saveNoteArgsSchema,
  correctLoggedSetArgsSchema,
  correctNoteArgsSchema,
  correctPreviousExerciseSetArgsSchema,
} from "./schema.js";

/**
 * §20 (tool-calling revision): each tool is a real, validated action, not
 * a JSON field the model has to remember to keep in sync with its own
 * prose. The model only sees a tool's *result* after calling it — the
 * final reply it composes is written with that result already in hand,
 * which is what structurally closes off the message/state desync bug the
 * first (single JSON-blob) design shipped.
 *
 * These tools never touch a database — this service has none. Each one
 * operates purely on the context the caller (`runConversationTurn`)
 * already assembled from the request, and records what happened into a
 * shared `outcome` object the caller reads once the loop ends. The real
 * writes (set_logs, session_exercise_skips, adhoc exercises) happen
 * server-side in `supabase/functions/_shared/mod.ts`, which re-validates
 * everything here against real DB state before trusting it — same
 * backstop discipline as before, just applied per tool call.
 */

export interface RemainingExerciseCandidate {
  exercise: Exercise;
  lastLogs: SetLog[];
  notes: string[];
  deferred: boolean;
}

export interface ToolContext {
  exercise: Exercise;
  thisSessionLogs: SetLog[];
  remainingExercises: RemainingExerciseCandidate[];
  /** The exercise (if any) most recently logged in this session before the current one — see correctPreviousExerciseSet. */
  previousExercise: Exercise | null;
  previousExerciseLogs: SetLog[];
}

export interface TurnOutcome {
  loggedSets: Array<{ weightKg: number; reps: number }>;
  stoppedEarly: boolean;
  stopReason: string | null;
  deferred: boolean;
  deferReason: string | null;
  switchToExerciseId: string | null;
  switchTarget: RemainingExerciseCandidate | null;
  substituteExercise: {
    name: string;
    sets: number;
    repRange: string;
    restSec: number;
    equipmentType: Exercise["equipmentType"] | null;
  } | null;
  noteToSave: { text: string; general: boolean } | null;
  /** A fix to a set already logged this session — never a new report. */
  correctedSet: { setNo: number; weightKg: number | null; reps: number | null } | null;
  /** A fix to the wording of the most recent note saved for this exercise. */
  correctedNote: { newText: string } | null;
  /** A fix to a set logged for the PREVIOUS exercise in this session, not the current one. */
  correctedPreviousExerciseSet: { exerciseId: string; setNo: number; weightKg: number | null; reps: number | null } | null;
}

export function emptyOutcome(): TurnOutcome {
  return {
    loggedSets: [],
    stoppedEarly: false,
    stopReason: null,
    deferred: false,
    deferReason: null,
    switchToExerciseId: null,
    switchTarget: null,
    substituteExercise: null,
    noteToSave: null,
    correctedSet: null,
    correctedNote: null,
    correctedPreviousExerciseSet: null,
  };
}

export function buildTurnTools(context: ToolContext, outcome: TurnOutcome): StructuredToolInterface[] {
  const logCompletedSets = tool(
    async ({ sets }) => {
      outcome.loggedSets.push(...sets);
      const totalSoFar = context.thisSessionLogs.length + outcome.loggedSets.length;
      const remaining = context.exercise.sets - totalSoFar;
      return remaining > 0
        ? `Recorded. ${totalSoFar} of ${context.exercise.sets} work sets now accounted for — ${remaining} remain.`
        : `Recorded. All ${context.exercise.sets} work sets now accounted for — this exercise is complete.`;
    },
    {
      name: "logCompletedSets",
      description:
        "Record the weight/reps for whatever sets THIS message reports for the current exercise. Call this whenever the user reports doing work, even a partial report — never decide completion yourself, the result tells you how many sets are now accounted for in total.",
      schema: logCompletedSetsArgsSchema,
    },
  );

  const stopExerciseEarly = tool(
    async ({ reason }) => {
      outcome.stoppedEarly = true;
      outcome.stopReason = reason;
      return "Noted — moving on from this exercise with whatever was logged.";
    },
    {
      name: "stopExerciseEarly",
      description:
        "Call when the user explicitly says they're done with this exercise despite not completing all planned sets (\"let's skip the rest\", \"that's enough\"). Call logCompletedSets first in the same turn if this message also reports anything.",
      schema: stopExerciseEarlyArgsSchema,
    },
  );

  const deferCurrentExercise = tool(
    async ({ reason }) => {
      outcome.deferred = true;
      outcome.deferReason = reason;
      return "Noted — setting this exercise aside for now, nothing logged. It'll come back up later in the session.";
    },
    {
      name: "deferCurrentExercise",
      description:
        "Call ONLY when nothing at all has been done on this exercise yet (0 sets logged) and the user wants to skip it for now without naming a specific alternative to do instead (e.g. \"this one's taken, let's move on\"). Do not call this if any sets were already logged this session for this exercise — use stopExerciseEarly instead.",
      schema: deferCurrentExerciseArgsSchema,
    },
  );

  const listAvailableExercises = tool(
    async () => {
      if (context.remainingExercises.length === 0) {
        return "No other fresh or deferred exercises are available to switch to right now.";
      }
      return context.remainingExercises
        .map((c) => `id: ${c.exercise.id} — "${c.exercise.name}"${c.deferred ? " (previously deferred)" : ""}, ${c.exercise.sets} sets of ${c.exercise.repRange} reps`)
        .join("\n");
    },
    {
      name: "listAvailableExercises",
      description:
        "Look up the other exercises (fresh or previously deferred) that could be switched to — use this BEFORE switchToExercise so you have a real id to reference, never invent one. Only call this when the user's message actually asks to switch to a specific different exercise already in the plan.",
      schema: z.object({}),
    },
  );

  const switchToExercise = tool(
    async ({ exerciseId }) => {
      const match = context.remainingExercises.find((c) => c.exercise.id === exerciseId);
      if (!match) {
        return "FAILED — that id doesn't match any available exercise. The switch did NOT happen. Call listAvailableExercises now and use an id from that exact list, or if you still can't find a match, your final reply must NOT claim you switched — stay on the current exercise and say so honestly.";
      }
      outcome.switchToExerciseId = exerciseId;
      outcome.switchTarget = match;
      const targets = suggestTargets(match.exercise, match.lastLogs);
      const lines = [
        `Switching to ${match.exercise.name}${match.deferred ? " (coming back to a previously deferred exercise)" : ""}.`,
        `Structure: ${match.exercise.sets} work sets, ${match.exercise.repRange} reps, rest ${match.exercise.restSec}s, intensity: ${match.exercise.intensity}.`,
        match.exercise.warmup ? `Warm-up: ${match.exercise.warmup}` : "No warm-up for this exercise.",
        "Last time on this exercise:",
        formatHistory(match.lastLogs),
        targets.reason === "baseline"
          ? "No reliable weight on record — do not invent a starting weight, ask the user what they'd like to start with."
          : `Computed target for today: ${targets.suggestedWeightKg}kg, sets of ${targets.targetReps?.join(", ")} reps.`,
      ];
      if (match.notes.length > 0) lines.push("Saved notes about this exercise:", ...match.notes.map((n) => `- ${n}`));
      return lines.join("\n");
    },
    {
      name: "switchToExercise",
      description:
        "Switch to a specific exercise already in the plan (fresh or previously deferred), by its real id from listAvailableExercises. Only call this when the user's message explicitly names or clearly points at a specific different exercise to do instead.",
      schema: switchToExerciseArgsSchema,
    },
  );

  const substituteExercise = tool(
    async (args) => {
      outcome.substituteExercise = args;
      return `Noted — substituting with ${args.name}: ${args.sets} sets of ${args.repRange} reps. This is a brand-new exercise with no history — ask the user what weight they'd like to use, don't invent one.`;
    },
    {
      name: "substituteExercise",
      description:
        "Introduce a movement not in the plan at all, exactly as the user named it (\"let's do leg press instead\"). Only call this when they name a SPECIFIC alternative — if they want to change what's next but haven't said what to, ask, don't call this.",
      schema: substituteExerciseArgsSchema,
    },
  );

  const saveNote = tool(
    async (args) => {
      outcome.noteToSave = args;
      return "Noted for future sessions.";
    },
    {
      name: "saveNote",
      description:
        "Save a freeform note for future sessions — a technique cue, a request for next time, something worth remembering. Can be called alongside any other tool in the same turn.",
      schema: saveNoteArgsSchema,
    },
  );

  const correctLoggedSet = tool(
    async ({ setNo, weightKg, reps }) => {
      const existing = context.thisSessionLogs.find((l) => l.setNo === setNo);
      if (!existing) {
        const loggedNos = context.thisSessionLogs.map((l) => l.setNo).join(", ");
        return `FAILED — set ${setNo} hasn't been logged yet this session for this exercise, so there's nothing to correct. ${loggedNos ? `Sets logged so far: ${loggedNos}.` : "No sets logged yet."} Ask the user which set they mean, or use logCompletedSets if they're actually reporting a new set.`;
      }
      if (weightKg == null && reps == null) {
        return "FAILED — no new weight or reps given, nothing to correct.";
      }
      outcome.correctedSet = { setNo, weightKg, reps };
      const newWeight = weightKg ?? existing.weightKg;
      const newReps = reps ?? existing.reps;
      return `Corrected set ${setNo}: was ${existing.weightKg}kg × ${existing.reps} reps, now ${newWeight}kg × ${newReps} reps.`;
    },
    {
      name: "correctLoggedSet",
      description:
        "Fix the weight and/or reps of a set ALREADY logged this session for the current exercise — call this when the user is correcting something they already reported (\"actually it was 65kg\", \"wait, set 2 was 8 reps not 6\"), never for a new report (use logCompletedSets for that). If it's unclear which already-logged set they mean, ask instead of guessing.",
      schema: correctLoggedSetArgsSchema,
    },
  );

  const correctNote = tool(
    async ({ newText }) => {
      outcome.correctedNote = { newText };
      return "Updated your most recent note for this exercise.";
    },
    {
      name: "correctNote",
      description:
        "Fix the wording of the note you most recently saved for this exercise — call this when the user is correcting something they just asked you to remember (\"actually make that my left knee, not my right\"), never for adding new information (use saveNote for that).",
      schema: correctNoteArgsSchema,
    },
  );

  const correctPreviousExerciseSet = tool(
    async ({ setNo, weightKg, reps }) => {
      if (!context.previousExercise) {
        return "FAILED — there's no previous exercise logged this session to correct. If this is about the CURRENT exercise, use correctLoggedSet instead.";
      }
      const existing = context.previousExerciseLogs.find((l) => l.setNo === setNo);
      if (!existing) {
        const loggedNos = context.previousExerciseLogs.map((l) => l.setNo).join(", ");
        return `FAILED — set ${setNo} of ${context.previousExercise.name} hasn't been logged, so there's nothing to correct. ${loggedNos ? `Sets logged: ${loggedNos}.` : "No sets logged."} Ask the user which set they mean.`;
      }
      if (weightKg == null && reps == null) {
        return "FAILED — no new weight or reps given, nothing to correct.";
      }
      outcome.correctedPreviousExerciseSet = { exerciseId: context.previousExercise.id, setNo, weightKg, reps };
      const newWeight = weightKg ?? existing.weightKg;
      const newReps = reps ?? existing.reps;
      return `Corrected ${context.previousExercise.name} set ${setNo}: was ${existing.weightKg}kg × ${existing.reps} reps, now ${newWeight}kg × ${newReps} reps.`;
    },
    {
      name: "correctPreviousExerciseSet",
      description:
        "Fix the weight and/or reps of a set logged for the PREVIOUS exercise in this session — the one done right before the current one — not the exercise you're currently on. Call this when the user names a different, already-finished exercise than the current one (e.g. you're now on Leg Press but they say \"in the goblet squats I actually did 8/7/7\"). Never use this for the current exercise (use correctLoggedSet for that), and never guess if the exercise they name doesn't match either the current or the previous one — ask instead.",
      schema: correctPreviousExerciseSetArgsSchema,
    },
  );

  return [
    logCompletedSets,
    stopExerciseEarly,
    deferCurrentExercise,
    listAvailableExercises,
    switchToExercise,
    substituteExercise,
    saveNote,
    correctLoggedSet,
    correctNote,
    correctPreviousExerciseSet,
  ];
}
