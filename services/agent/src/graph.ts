import type { Exercise, SetLog } from "@gymcoach/shared";

/**
 * Coaching turn pipeline — M0 skeleton.
 *
 * M1 (GYM-19) replaces these stubs with the real LangGraph wiring:
 *   fetchHistory -> suggestTargets -> composeReply (Gemini, persona prompt).
 * The three-step shape is fixed here so the Edge Functions can integrate
 * against a stable contract before the LLM is connected.
 */

export interface TurnInput {
  userId: string;
  planId: string;
  exercise: Exercise;
  lastLogs: SetLog[];
}

export interface TurnOutput {
  /** Coach reply, in the user's language, one complete message. */
  message: string;
  suggestedWeightKg: number | null;
  suggestedReps: number[] | null;
}

export async function runCoachingTurn(input: TurnInput): Promise<TurnOutput> {
  // M1: real implementation. M0 returns a deterministic echo so the
  // end-to-end plumbing (app -> edge fn -> agent) can be exercised.
  const last = input.lastLogs.at(-1);
  return {
    message: `stub:${input.exercise.name}`,
    suggestedWeightKg: last ? last.weightKg : null,
    suggestedReps: null,
  };
}
