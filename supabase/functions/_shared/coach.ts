import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { checkSpend, costCents, LIMIT_REACHED_ERROR, recordSpend, type SpendBucket, usageOrFallback } from "./assistant.ts";

/**
 * My Coach's in-workout turns on Token Factory (DOR-135): session-start's
 * exercise intro, coach-turn's free-text turn and its set confirmation. The
 * hackathon app runs services/agent's own code inside the Edge Function
 * (../_coach/agent.ts) with Nemotron in place of the live app's Gemini, on
 * My Coach's key and daily ceiling ('coach', D-34). The live app's agent
 * service isn't connected to this project (D-16).
 *
 * This module is the policy around one agent call, with the agent itself
 * passed in, so it is tested without the model:
 *  - under the ceiling, the call runs on Token Factory, its spend is recorded
 *    in the 'coach' bucket and the usage handed back for usage_ledger is
 *    priced at Token Factory's rates, not the agent's Gemini ones;
 *  - at the ceiling nothing reaches the model: a workout doesn't start and a
 *    free-text turn isn't read (503 coach_unavailable, the app's own message),
 *    while sets confirmed with the buttons are still saved and answered by
 *    the agent's deterministic reply, so a running workout can be finished;
 *  - a call that fails after reaching Token Factory is charged the fallback
 *    usage, so a failure can't switch the ceiling off.
 */

/**
 * Measured on 2026-10-22 in Supabase's runtime, in Hebrew and English:
 * 1.0 to 1.8 s a reply with thinking off, 2.2 to 5.5 s for the turn that logs
 * sets (`low`), every set logged right, about 3 cents a workout.
 */
export const DEFAULT_COACH_MODEL = "nvidia/nemotron-3-super-120b-a12b";

export function coachModel(get: (name: string) => string | undefined = (n) => Deno.env.get(n)): string {
  return get("COACH_MODEL") || DEFAULT_COACH_MODEL;
}

/** The agent service's routes this replaces, as mod.ts calls them. */
export type CoachPath = "/turn" | "/converse" | "/confirm-turn";

/** What the agent returns for every route: its own reply fields, plus these. */
export interface CoachReply {
  usage?: { tokensInput?: number; tokensOutput?: number; costCents?: number };
  degraded?: boolean;
}

/** Runs one agent route in process; a null key gives the agent's deterministic reply. */
export type CoachRunner = (path: CoachPath, payload: unknown, apiKey: string | null) => Promise<CoachReply>;

/** A payload the agent's own schema rejects: thrown before any model call. */
export class CoachInputError extends Error {}

/** Same shape as mod.ts's callAgent, so the turn code doesn't change. */
export type AgentCall = (payload: unknown, path?: string) => Promise<Response>;

const BUCKET: SpendBucket = "coach";
const PATHS: readonly string[] = ["/turn", "/converse", "/confirm-turn"];

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Token Factory refused the key: the call failed before using any tokens. */
function refusedKey(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  return status === 401 || status === 403;
}

export function coachAgentCall(
  db: Pick<SupabaseClient, "rpc">,
  run: CoachRunner,
  opts: { apiKey?: string; model?: string; ceilings?: Record<SpendBucket, number> } = {},
): AgentCall {
  const apiKey = opts.apiKey ?? Deno.env.get("COACH_TOKEN_FACTORY_API_KEY") ?? "";
  const model = opts.model ?? coachModel();

  return async (payload, path = "/turn") => {
    if (!PATHS.includes(path)) return reply(404, { error: "unknown_route" });
    if (!apiKey) return reply(503, { error: "agent_not_configured" });

    const atCeiling = !(await checkSpend(db, BUCKET, opts.ceilings)).allowed;
    if (atCeiling && path !== "/confirm-turn") {
      return reply(503, { error: "coach_unavailable", reason: LIMIT_REACHED_ERROR });
    }

    let out: CoachReply;
    try {
      out = await run(path as CoachPath, payload, atCeiling ? null : apiKey);
    } catch (e) {
      if (e instanceof CoachInputError) return reply(400, { error: "invalid_input" });
      console.error("coach turn failed", { path, model, error: String(e).slice(0, 300) });
      if (!refusedKey(e)) await recordSpend(db, BUCKET, model, null);
      return reply(503, { error: "coach_unavailable" });
    }

    if (out.degraded) {
      return reply(200, { ...out, usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 } });
    }
    // A reply from the model always read some input; none reported means the
    // usage went missing (the agent counts an absent one as 0), not that the
    // turn was free.
    const usage = usageOrFallback(out.usage?.tokensInput ? out.usage : null);
    await recordSpend(db, BUCKET, model, usage);
    return reply(200, { ...out, usage: { ...usage, costCents: costCents(model, usage) } });
  };
}
