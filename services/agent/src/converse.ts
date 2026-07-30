import { StateGraph, START, END } from "@langchain/langgraph";
import { z } from "zod";
import type { CoachProfile, Exercise, SetLog } from "@gymcoach/shared";
import { suggestTargets, type Targets } from "./progression.js";
import { buildSystemPrompt, buildConversationPrompt } from "./prompt.js";
import { composeConversationTurn, type LlmUsage } from "./llm.js";

/**
 * Free-text mid-workout turn graph (GYM-61/67):
 *   computeNextTargets (deterministic, only if a next exercise exists)
 *   -> composeReply (Gemini: interpret + narrate in one structured call)
 *
 * Kept as its own graph rather than folded into the intro-only
 * runCoachingTurn: that flow always introduces `input.exercise` and never
 * takes user free text, so mixing concerns there would make both paths
 * harder to reason about.
 */

export interface ConversationInput {
  profile: CoachProfile;
  exercise: Exercise;
  lastLogs: SetLog[];
  notes: string[];
  userMessage: string;
  recentHistory: Array<{ from: "coach" | "me"; text: string }>;
  nextExercise: Exercise | null;
  nextLastLogs: SetLog[];
  nextNotes: string[];
}

export interface ConversationOutput {
  message: string;
  loggedSets: Array<{ weightKg: number; reps: number }>;
  advance: boolean;
  usage: LlmUsage;
  degraded: boolean;
  /**
   * The deterministic target for the exercise the reply is introducing
   * (null if there's no next exercise, or a baseline session). Returned
   * separately from `message` because the LLM composes the message in
   * prose and can occasionally mistranscribe a number while doing so —
   * the client should render these, not parse them back out of the text.
   */
  nextSuggestedWeightKg: number | null;
  nextTargetReps: number[] | null;
  noteToSave: { text: string; general: boolean } | null;
}

const stateSchema = z.object({
  input: z.custom<ConversationInput>(),
  currentTargets: z.custom<Targets | null>().optional(),
  nextTargets: z.custom<Targets | null>().optional(),
  output: z.custom<ConversationOutput>().optional(),
});

type GraphState = z.infer<typeof stateSchema>;

async function targetsNode(state: GraphState): Promise<Partial<GraphState>> {
  const { input } = state;
  return {
    // The target this exercise was introduced with (before any in-chat
    // renegotiation) — given to the LLM as a reliable fallback so a
    // reps-only report ("8, 8, 8") doesn't get logged at 0kg just
    // because this particular message didn't repeat the weight.
    currentTargets: suggestTargets(input.exercise, input.lastLogs),
    nextTargets: input.nextExercise
      ? suggestTargets(input.nextExercise, input.nextLastLogs)
      : null,
  };
}

async function composeNode(state: GraphState): Promise<Partial<GraphState>> {
  const { input, currentTargets, nextTargets } = state;
  const systemPrompt = buildSystemPrompt(input.profile);
  const turnPrompt = buildConversationPrompt({
    exercise: input.exercise,
    lastLogs: input.lastLogs,
    notes: input.notes,
    userMessage: input.userMessage,
    recentHistory: input.recentHistory,
    currentTargets: currentTargets ?? null,
    nextExercise: input.nextExercise,
    nextTargets: nextTargets ?? null,
    nextLastLogs: input.nextLastLogs,
  });

  const reply = await composeConversationTurn(systemPrompt, turnPrompt);
  if (reply) {
    return {
      output: {
        ...reply,
        nextSuggestedWeightKg: nextTargets?.suggestedWeightKg ?? null,
        nextTargetReps: nextTargets?.targetReps ?? null,
      },
    };
  }

  // No API key (local dev): a safe no-op so the pipeline stays
  // exercisable without spending a token or losing the user's report.
  return {
    output: {
      message: "Got it — recorded. Let's keep going!",
      loggedSets: [],
      advance: true,
      usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 },
      degraded: true,
      nextSuggestedWeightKg: null,
      nextTargetReps: null,
      noteToSave: null,
    },
  };
}

const graph = new StateGraph(stateSchema)
  .addNode("targets", targetsNode)
  .addNode("compose", composeNode)
  .addEdge(START, "targets")
  .addEdge("targets", "compose")
  .addEdge("compose", END)
  .compile();

export async function runConversationTurn(
  input: ConversationInput,
): Promise<ConversationOutput> {
  const result = await graph.invoke({ input });
  return result.output!;
}
