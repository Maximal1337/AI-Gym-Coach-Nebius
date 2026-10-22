import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  checkSpend,
  costCents,
  type FeatureFlag,
  isFlagEnabled,
  LIMIT_REACHED_ERROR,
  recordSpend,
  type SpendBucket,
  usageOrFallback,
} from "./assistant.ts";

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
 *    while sets confirmed with the buttons are still saved and answered
 *    without it, in the user's language, so a running workout can be finished;
 *  - a call that fails after reaching Token Factory is charged the fallback
 *    usage, so a failure can't switch the ceiling off.
 */

/**
 * My Coach's model calls — plan generation, plan import's parse, a workout's
 * start and its free-text turns — are for accounts with the assistant, behind
 * the chat's own flag (its global switch and the account's row). The
 * TestFlight link is public: anyone signing in with Apple would otherwise
 * spend the coach bucket the judges need. Saving a plan and confirming sets
 * with the buttons reach no model and stay open.
 */
export const COACH_FLAG: FeatureFlag = "assistant_chat";

/** The chat's refusal code for an account without the assistant; the app shows its own message. */
export const COACH_DISABLED_ERROR = "assistant_disabled";

/** null when the account may use My Coach's model calls, else the 403 to answer. Fails closed. */
export async function coachFlagRefusal(
  db: Pick<SupabaseClient, "rpc">,
  userId: string,
): Promise<{ status: 403; body: { error: string } } | null> {
  return (await isFlagEnabled(db as SupabaseClient, userId, COACH_FLAG))
    ? null
    : { status: 403, body: { error: COACH_DISABLED_ERROR } };
}

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

const SETS_LOGGED: Record<string, (sets: string) => string> = {
  en: (s) => `Logged ${s}. Let's keep going!`,
  he: (s) => `רשמתי: ${s}. ממשיכים!`,
  ar: (s) => `سجّلت: ${s}. لنواصل!`,
  es: (s) => `Registrado: ${s}. ¡Sigamos!`,
  de: (s) => `Eingetragen: ${s}. Weiter geht's!`,
  pt: (s) => `Registrado: ${s}. Vamos em frente!`,
  fr: (s) => `C'est noté : ${s}. On continue !`,
  it: (s) => `Registrato: ${s}. Andiamo avanti!`,
};

/** As services/agent/src/units.ts: stored in kg, shown in the user's units to the half. */
function formatWeight(kg: number, imperial: boolean): string {
  return `${Math.round((imperial ? kg * 2.20462 : kg) * 2) / 2}${imperial ? "lb" : "kg"}`;
}

/**
 * The reply to sets confirmed without the model (at the ceiling), in the
 * user's language — the agent's own is English only. null when the payload
 * has no sets to name.
 */
export function setsLoggedReply(payload: unknown): string | null {
  const p = payload as {
    profile?: { language?: unknown; units?: unknown };
    confirmedSets?: Array<{ weightKg?: unknown; reps?: unknown }>;
  } | null;
  const sets = (Array.isArray(p?.confirmedSets) ? p.confirmedSets : [])
    .filter((s): s is { weightKg: number; reps: number } => typeof s?.weightKg === "number" && typeof s?.reps === "number");
  if (sets.length === 0) return null;
  const imperial = p?.profile?.units === "imperial";
  const text = sets.every((s) => s.weightKg === sets[0].weightKg)
    ? `${formatWeight(sets[0].weightKg, imperial)} × ${sets.map((s) => s.reps).join("/")}`
    : sets.map((s) => `${formatWeight(s.weightKg, imperial)} × ${s.reps}`).join(", ");
  const language = String(p?.profile?.language ?? "").slice(0, 2).toLowerCase();
  return (SETS_LOGGED[language] ?? SETS_LOGGED.en)(text);
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
      const message = path === "/confirm-turn" ? setsLoggedReply(payload) : null;
      return reply(200, { ...out, ...(message ? { message } : {}), usage: { tokensInput: 0, tokensOutput: 0, costCents: 0 } });
    }
    // A reply from the model always read some input; none reported means the
    // usage went missing (the agent counts an absent one as 0), not that the
    // turn was free.
    const usage = usageOrFallback(out.usage?.tokensInput ? out.usage : null);
    await recordSpend(db, BUCKET, model, usage);
    return reply(200, { ...out, usage: { ...usage, costCents: costCents(model, usage) } });
  };
}
