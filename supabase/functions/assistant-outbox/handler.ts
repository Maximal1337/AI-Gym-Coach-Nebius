import type { JsonSchema } from "../_shared/mcp.ts";
import { validate } from "../_shared/mcp.ts";
import type { RelayEnvironment } from "../_shared/relay-auth.ts";
import { LIMIT_REACHED_ERROR, type TokenUsage } from "../_shared/assistant.ts";

/**
 * assistant-outbox (NH-52): the relay on the VPS pulls work here — the VPS
 * accepts no inbound traffic (D-27), so nothing is ever pushed to it.
 * Requests are signed per environment (_shared/relay-auth.ts), and the
 * signature decides which environment's queue is served.
 *
 *   {"action":"claim","limit":2,"lease_seconds":180}
 *     → {"jobs":[{id, lease_token, leased_until, job, message, history, facts, user, agent}]}
 *       At the environment's D-34 spend ceiling: {"jobs":[],"paused":"daily_limit_reached"}.
 *   {"action":"fail","job_id":1,"lease_token":"…","error":"…","model":"…","usage":{…}}
 *     → {"ok":true|false}. A failed attempt still spent tokens, so usage is
 *       recorded; the job goes back to the queue until its attempts run out.
 * Success is reported to assistant-deliver, which stores the reply.
 *
 * A claimed job that must not run at all ends before its context is built:
 * the user's assistant flags are off (the kill switch, or the flag removed
 * after the job was queued), or it's a check-in for a user without a
 * subscription (assistant-send refuses those users' messages with 402; a
 * check-in has no send). jobRefusal decides; the job is dropped, for good.
 *
 * The sandbox manager in the relay (NH-55, NH-56) uses three more:
 *   {"action":"defer","job_id":1,"lease_token":"…","seconds":20,"reason":"capacity"}
 *     → {"ok":true|false}. The user's sandbox can't run the job yet (no free
 *       slot, still starting): back to the queue without spending the attempt.
 *   {"action":"record_agent","user_id":"…","sandbox_name":"notch-prod-…","tool_token_hash":"<sha256 hex>"}
 *     → {"status":"recorded"|"user_gone"|"wrong_environment"}, before the
 *       sandbox is created, so a sandbox never exists without its row.
 *   {"action":"list_agents"} → {"agents":[{"user_id":"…","sandbox_name":"…"}]}
 *     for the environment; the sweep deletes every sandbox not on it.
 */
export interface OutboxDeps {
  verify: (req: Request, body: string) => Promise<RelayEnvironment | null>;
  spendAllowed: (env: RelayEnvironment) => Promise<boolean>;
  claim: (env: RelayEnvironment, limit: number, leaseSeconds: number) => Promise<Record<string, unknown>[]>;
  context: (jobId: number) => Promise<Record<string, unknown>>;
  /** Why a claimed job must not run at all (jobRefusal), or null. Throws when it can't tell. */
  refusal: (job: Record<string, unknown>) => Promise<string | null>;
  /** Ends a leased job for good (assistant_drop_job). */
  drop: (env: RelayEnvironment, jobId: number, leaseToken: string, reason: string) => Promise<boolean>;
  fail: (env: RelayEnvironment, jobId: number, leaseToken: string, error: string) => Promise<boolean>;
  recordSpend: (env: RelayEnvironment, model: string, usage: Partial<TokenUsage> | undefined) => Promise<unknown>;
  defer: (env: RelayEnvironment, jobId: number, leaseToken: string, seconds: number, reason: string | null) => Promise<boolean>;
  recordAgent: (env: RelayEnvironment, userId: string, sandboxName: string, tokenHash: string) => Promise<string>;
  listAgents: (env: RelayEnvironment) => Promise<Array<{ user_id: string; sandbox_name: string }>>;
}

const USAGE: JsonSchema = {
  type: "object",
  properties: { tokensInput: { type: "integer", minimum: 0 }, tokensOutput: { type: "integer", minimum: 0 } },
  required: ["tokensInput", "tokensOutput"],
  additionalProperties: false,
};

export const CLAIM_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["claim"] },
    limit: { type: "integer", minimum: 1, maximum: 10 },
    lease_seconds: { type: "integer", minimum: 30, maximum: 900 },
  },
  required: ["action"],
  additionalProperties: false,
};

export const FAIL_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["fail"] },
    job_id: { type: "integer", minimum: 1 },
    lease_token: { type: "string", format: "uuid" },
    error: { type: "string", maxLength: 2000 },
    model: { type: "string", minLength: 1, maxLength: 200 },
    usage: USAGE,
  },
  required: ["action", "job_id", "lease_token", "error"],
  additionalProperties: false,
};

export const DEFER_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["defer"] },
    job_id: { type: "integer", minimum: 1 },
    lease_token: { type: "string", format: "uuid" },
    seconds: { type: "integer", minimum: 1, maximum: 3600 },
    reason: { type: "string", maxLength: 200 },
  },
  required: ["action", "job_id", "lease_token", "seconds"],
  additionalProperties: false,
};

export const RECORD_AGENT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["record_agent"] },
    user_id: { type: "string", format: "uuid" },
    sandbox_name: { type: "string", pattern: "^notch-(dev|prod)-[a-z0-9-]{1,50}$" },
    tool_token_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
  required: ["action", "user_id", "sandbox_name", "tool_token_hash"],
  additionalProperties: false,
};

export const LIST_AGENTS_SCHEMA: JsonSchema = {
  type: "object",
  properties: { action: { type: "string", enum: ["list_agents"] } },
  required: ["action"],
  additionalProperties: false,
};

/** What jobRefusal needs to look up; each throws when it can't tell. */
export interface RefusalChecks {
  flagEnabled: (userId: string, flag: "assistant_chat" | "assistant_checkin") => Promise<boolean>;
  entitled: (userId: string) => Promise<boolean>;
}

/**
 * Why a claimed job must not run at all, or null. A chat job needs the user's
 * assistant_chat flag; a check-in needs assistant_checkin too, and a
 * subscription, since nothing else stands between it and a paid turn.
 */
export async function jobRefusal(job: Record<string, unknown>, checks: RefusalChecks): Promise<string | null> {
  const userId = job.user_id as string;
  if (!(await checks.flagEnabled(userId, "assistant_chat"))) return "assistant_disabled";
  if (job.kind !== "checkin") return null;
  if (!(await checks.flagEnabled(userId, "assistant_checkin"))) return "assistant_disabled";
  if (!(await checks.entitled(userId))) return "subscription_required";
  return null;
}

export const DEFAULT_CLAIM_LIMIT = 2;
export const DEFAULT_LEASE_SECONDS = 180;

export async function handleOutbox(req: Request, deps: OutboxDeps): Promise<Response> {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const text = await req.text();
  const env = await deps.verify(req, text);
  if (!env) return reply(401, { error: "unauthorized" });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "invalid_input" });
  }

  if (body?.action === "claim") {
    const invalid = validate(CLAIM_SCHEMA, body, "body");
    if (invalid) return reply(400, { error: "invalid_input", detail: invalid });
    if (!(await deps.spendAllowed(env))) return reply(200, { jobs: [], paused: LIMIT_REACHED_ERROR });
    const leased = await deps.claim(
      env,
      (body.limit as number | undefined) ?? DEFAULT_CLAIM_LIMIT,
      (body.lease_seconds as number | undefined) ?? DEFAULT_LEASE_SECONDS,
    );
    const jobs = [];
    for (const job of leased) {
      const id = job.id as number;
      const leaseToken = job.lease_token as string;
      try {
        const refusal = await deps.refusal(job);
        if (refusal) {
          console.log("assistant job dropped", { jobId: id, kind: job.kind, reason: refusal });
          await deps.drop(env, id, leaseToken, refusal);
          continue;
        }
        jobs.push({ id, lease_token: leaseToken, leased_until: job.leased_until, ...(await deps.context(id)) });
      } catch (e) {
        // One job's checks or context failing mustn't strand the rest of the
        // batch until their leases run out. This one goes back now, its attempt
        // spent, so a job whose context never loads still ends.
        console.error("assistant job not handed out", { jobId: id, error: String(e) });
        await deps.fail(env, id, leaseToken, `context_error: ${String(e)}`.slice(0, 2000)).catch(() => false);
      }
    }
    return reply(200, { jobs });
  }

  if (body?.action === "fail") {
    const invalid = validate(FAIL_SCHEMA, body, "body");
    if (invalid) return reply(400, { error: "invalid_input", detail: invalid });
    if (body.model) await deps.recordSpend(env, body.model as string, body.usage as Partial<TokenUsage> | undefined);
    const ok = await deps.fail(env, body.job_id as number, body.lease_token as string, body.error as string);
    return reply(200, { ok });
  }

  if (body?.action === "defer") {
    const invalid = validate(DEFER_SCHEMA, body, "body");
    if (invalid) return reply(400, { error: "invalid_input", detail: invalid });
    const ok = await deps.defer(
      env,
      body.job_id as number,
      body.lease_token as string,
      body.seconds as number,
      (body.reason as string | undefined) ?? null,
    );
    return reply(200, { ok });
  }

  if (body?.action === "record_agent") {
    const invalid = validate(RECORD_AGENT_SCHEMA, body, "body");
    if (invalid) return reply(400, { error: "invalid_input", detail: invalid });
    // The name must belong to the signing environment; the SQL function checks it too.
    if (!(body.sandbox_name as string).startsWith(`notch-${env}-`)) {
      return reply(400, { error: "invalid_input", detail: "sandbox_name is for another environment" });
    }
    const status = await deps.recordAgent(env, body.user_id as string, body.sandbox_name as string, body.tool_token_hash as string);
    return reply(200, { status });
  }

  if (body?.action === "list_agents") {
    const invalid = validate(LIST_AGENTS_SCHEMA, body, "body");
    if (invalid) return reply(400, { error: "invalid_input", detail: invalid });
    return reply(200, { agents: await deps.listAgents(env) });
  }

  return reply(400, { error: "invalid_input", detail: "body.action must be claim, fail, defer, record_agent or list_agents" });
}
