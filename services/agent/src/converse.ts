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
}

const stateSchema = z.object({
  input: z.custom<ConversationInput>(),
  nextTargets: z.custom<Targets | null>().optional(),
  output: z.custom<ConversationOutput>().optional(),
});

type GraphState = z.infer<typeof stateSchema>;

async function targetsNode(state: GraphState): Promise<Partial<GraphState>> {
  const { input } = state;
  return {
    nextTargets: input.nextExercise
      ? suggestTargets(input.nextExercise, input.nextLastLogs)
      : null,
  };
}

async function composeNode(state: GraphState): Promise<Partial<GraphState>> {
  const { input, nextTargets } = state;
  const systemPrompt = buildSystemPrompt(input.profile);
  const turnPrompt = buildConversationPrompt({
    exercise: input.exercise,
    lastLogs: input.lastLogs,
    notes: input.notes,
    userMessage: input.userMessage,
    recentHistory: input.recentHistory,
    nextExercise: input.nextExercise,
    nextTargets: nextTargets ?? null,
    nextLastLogs: input.nextLastLogs,
  });

  const reply = await composeConversationTurn(systemPrompt, turnPrompt);
  if (reply) return { output: reply };

  // No API key (local dev): a safe no-op so the pipeline stays
  // exercisable without spending a token or losing the user's report.
  return {
    output: {
      message: "Got it — recorded. Let's keep going!",
      loggedSets: [],
      advance: true,
      usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 },
      degraded: true,
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
