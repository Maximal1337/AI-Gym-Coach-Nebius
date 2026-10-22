import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { setLlmApiKey } from "../../../services/agent/src/config.ts";
import { runConfirmTurn, runConversationTurn } from "../../../services/agent/src/converse.ts";
import { runCoachingTurn } from "../../../services/agent/src/graph.ts";
import { confirmTurnInputSchema, conversationTurnInputSchema, turnInputSchema } from "../../../services/agent/src/schema.ts";
import { type AgentCall, coachAgentCall, CoachInputError, type CoachRunner } from "../_shared/coach.ts";

/**
 * services/agent's in-workout coach, run inside this function rather than
 * called over HTTP (DOR-135): the same routes the agent service serves, with
 * the same input schemas. Imports resolve through the function's deno.json,
 * which also points the agent's ChatOpenRouter at Token Factory
 * (./openrouter.ts). The policy around each call is ../_shared/coach.ts.
 *
 * The key is module state in the agent (llmApiKey), set for each call. Two
 * calls running at once in one isolate only want different keys at the
 * moment the day's ceiling is reached, so at worst one of them gets the other
 * kind of reply there.
 */
function parsed<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new CoachInputError("invalid_input");
  return result.data;
}

export const runCoachAgent: CoachRunner = (path, payload, apiKey) => {
  setLlmApiKey(apiKey);
  switch (path) {
    case "/turn":
      return runCoachingTurn(parsed(turnInputSchema, payload));
    case "/converse":
      return runConversationTurn(parsed(conversationTurnInputSchema, payload));
    case "/confirm-turn":
      return runConfirmTurn(parsed(confirmTurnInputSchema, payload));
  }
};

/** The agent call session-start and coach-turn hand to mod.ts's turn code. */
export function coachAgent(db: Pick<SupabaseClient, "rpc">): AgentCall {
  return coachAgentCall(db, runCoachAgent);
}
