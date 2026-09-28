import { LIMIT_REACHED_ERROR } from "../_shared/assistant.ts";

/**
 * assistant-send (NH-51): the app posts a coach chat message here. The reply
 * doesn't come back in this response — the agent runs on the VPS — it lands
 * in assistant_messages (the app reads its own rows) with a push notification.
 *
 * Checks, in order, each failing closed:
 *   401 no user · 403 assistant_disabled (the flag, also the kill switch) ·
 *   402 subscription_required (same contract as coach-turn) · 429 rate_limited ·
 *   400 invalid_input · 429 daily_limit_reached, with a reason: "spend" (the
 *   environment's D-34 ceiling), "messages" (this account's daily cap) or
 *   "global" (everyone's cap).
 * A retried client_message_id returns the original message with 200 even
 * when a limit has been reached since; a new message is 202.
 */
export interface SendDeps {
  corsHeaders: (req: Request) => Record<string, string>;
  getUser: (req: Request) => Promise<{ id: string } | null>;
  isEnabled: (userId: string) => Promise<boolean>;
  entitlement: (userId: string) => Promise<{ ok: boolean; trialEndsAt: string | null }>;
  allowRate: (userId: string) => Promise<boolean>;
  environmentFor: (userId: string) => Promise<"dev" | "prod">;
  /** Whether the environment's D-34 spend ceiling still has room today. */
  spendAllowed: (environment: "dev" | "prod") => Promise<boolean>;
  caps: () => { messagesPerUser: number; messagesGlobal: number };
  enqueue: (
    userId: string,
    text: string,
    clientMessageId: string,
    userCap: number,
    globalCap: number,
  ) => Promise<{ data: Record<string, unknown> } | { refusal: string }>;
}

export const MAX_MESSAGE_LENGTH = 2000;

export function parseSendBody(raw: unknown): { text: string; clientMessageId: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { text, client_message_id } = raw as Record<string, unknown>;
  if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_MESSAGE_LENGTH) return null;
  if (typeof client_message_id !== "string" || client_message_id.length < 1 || client_message_id.length > 100) return null;
  return { text, clientMessageId: client_message_id };
}

export async function handleSend(req: Request, deps: SendDeps): Promise<Response> {
  const cors = deps.corsHeaders(req);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const user = await deps.getUser(req);
  if (!user) return reply(401, { error: "unauthorized" });
  if (!(await deps.isEnabled(user.id))) return reply(403, { error: "assistant_disabled" });
  const access = await deps.entitlement(user.id);
  if (!access.ok) return reply(402, { error: "subscription_required", trialEndsAt: access.trialEndsAt });
  if (!(await deps.allowRate(user.id))) return reply(429, { error: "rate_limited" });

  let parsed: ReturnType<typeof parseSendBody>;
  try {
    parsed = parseSendBody(await req.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return reply(400, { error: "invalid_input" });

  // At the spend ceiling, caps of 0 still let a retried message come back as
  // itself (the database checks duplicates first) while refusing new ones.
  const environment = await deps.environmentFor(user.id);
  const spendOk = await deps.spendAllowed(environment);
  const caps = spendOk ? deps.caps() : { messagesPerUser: 0, messagesGlobal: 0 };

  const result = await deps.enqueue(user.id, parsed.text, parsed.clientMessageId, caps.messagesPerUser, caps.messagesGlobal);
  if ("refusal" in result) {
    if (result.refusal === "invalid_input") return reply(400, { error: "invalid_input" });
    const reason = !spendOk ? "spend" : result.refusal === "global_daily_cap" ? "global" : "messages";
    if (result.refusal === "user_daily_cap" || result.refusal === "global_daily_cap") {
      return reply(429, { error: LIMIT_REACHED_ERROR, reason });
    }
    throw new Error(`assistant_enqueue_message: unexpected refusal ${result.refusal}`);
  }
  const { duplicate, message, job_status } = result.data;
  return reply(duplicate ? 200 : 202, { message, duplicate, status: job_status });
}
