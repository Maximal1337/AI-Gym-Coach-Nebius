import { StateGraph, START, END } from "@langchain/langgraph";
import { z } from "zod";
import type { CoachProfile, Exercise, SetLog } from "@gymcoach/shared";
import { suggestTargets, type Targets } from "./progression.js";
import { buildSystemPrompt, buildTurnPrompt } from "./prompt.js";
import { composeWithLlm, type LlmUsage } from "./llm.js";
import { decideWorkingWeight } from "./decideWeight.js";

/**
 * Coaching turn graph (GYM-19):
 *   suggestTargets (deterministic rules) -> composeReply (Gemini, persona prompt)
 *
 * History fetching stays in the Edge Function (service_role reads), so this
 * service holds no database credentials — it receives data, returns a reply.
 */

export interface TurnInput {
  userId: string;
  planId: string;
  planName: string;
  planExercises: Array<{ name: string; orderIndex: number }>;
  profile: CoachProfile;
  exercise: Exercise;
  lastLogs: SetLog[];
  notes: string[];
}

export interface TurnOutput {
  message: string;
  suggestedWeightKg: number | null;
  targetReps: number[] | null;
  /** Per-set weight — the real source of truth when a set carried its own track (see progression.ts); suggestedWeightKg alone can't express that. */
  targetWeights: number[] | null;
  usage: LlmUsage;
  degraded: boolean;
}

const stateSchema = z.object({
  input: z.custom<TurnInput>(),
  targets: z.custom<Targets>().optional(),
  output: z.custom<TurnOutput>().optional(),
});

type GraphState = z.infer<typeof stateSchema>;

async function suggestNode(state: GraphState): Promise<Partial<GraphState>> {
  return { targets: suggestTargets(state.input.exercise, state.input.lastLogs) };
}

/** The compose call plus the separate weight-decision call (decideWeight.ts) both spend tokens — report the sum. */
function mergeUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    tokensInput: a.tokensInput + b.tokensInput,
    tokensOutput: a.tokensOutput + b.tokensOutput,
    costCents: a.costCents + b.costCents,
  };
}

async function composeNode(state: GraphState): Promise<Partial<GraphState>> {
  const { input } = state;
  const defaultTargets = state.targets!;

  // A saved weight preference (e.g. "keep me at 84kg") can override the
  // deterministic weight — decide it before composing so the target that
  // fills the set component matches what the coach will say (reps stay
  // deterministic, computed at the chosen weight). See decideWeight.ts.
  const decision = await decideWorkingWeight({
    exercise: input.exercise,
    lastLogs: input.lastLogs,
    notes: input.notes,
    defaultTargets,
    units: input.profile.units,
  });
  const targets = decision.overrideWeightKg != null
    ? suggestTargets(input.exercise, input.lastLogs, decision.overrideWeightKg)
    : defaultTargets;

  const systemPrompt = buildSystemPrompt(input.profile);
  const turnPrompt = buildTurnPrompt(
    input.exercise,
    input.lastLogs,
    targets,
    input.notes,
    input.profile.units,
    { planName: input.planName, planExercises: input.planExercises },
  );

  const llmReply = await composeWithLlm(systemPrompt, turnPrompt);
  if (llmReply) {
    return {
      output: {
        message: llmReply.message,
        suggestedWeightKg: targets.suggestedWeightKg,
        targetReps: targets.targetReps,
        targetWeights: targets.targetWeights,
        usage: mergeUsage(llmReply.usage, decision.usage),
        degraded: false,
      },
    };
  }

  // No API key (local dev): deterministic reply so the full pipeline stays
  // exercisable end-to-end without spending a token.
  const fallback =
    targets.reason === "baseline"
      ? `${input.exercise.name}: first session — find your working weight, ${input.exercise.sets}x${input.exercise.repRange}, rest ${input.exercise.restSec}s.`
      : `${input.exercise.name}: target ${targets.suggestedWeightKg}kg x ${targets.targetReps?.join("/")} (${targets.reason}), rest ${input.exercise.restSec}s.`;
  return {
    output: {
      message: fallback,
      suggestedWeightKg: targets.suggestedWeightKg,
      targetReps: targets.targetReps,
      targetWeights: targets.targetWeights,
      usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 },
      degraded: true,
    },
  };
}

const graph = new StateGraph(stateSchema)
  .addNode("suggest", suggestNode)
  .addNode("compose", composeNode)
  .addEdge(START, "suggest")
  .addEdge("suggest", "compose")
  .addEdge("compose", END)
  .compile();

export async function runCoachingTurn(input: TurnInput): Promise<TurnOutput> {
  const result = await graph.invoke({ input });
  return result.output!;
}
