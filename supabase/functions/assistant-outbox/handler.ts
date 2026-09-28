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
 */
export interface OutboxDeps {
  verify: (req: Request, body: string) => Promise<RelayEnvironment | null>;
  spendAllowed: (env: RelayEnvironment) => Promise<boolean>;
  claim: (env: RelayEnvironment, limit: number, leaseSeconds: number) => Promise<Record<string, unknown>[]>;
  context: (jobId: number) => Promise<Record<string, unknown>>;
  fail: (jobId: number, leaseToken: string, error: string) => Promise<boolean>;
  recordSpend: (env: RelayEnvironment, model: string, usage: Partial<TokenUsage> | undefined) => Promise<unknown>;
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
      jobs.push({ id: job.id, lease_token: job.lease_token, leased_until: job.leased_until, ...(await deps.context(job.id as number)) });
    }
    return reply(200, { jobs });
  }

  if (body?.action === "fail") {
    const invalid = validate(FAIL_SCHEMA, body, "body");
    if (invalid) return reply(400, { error: "invalid_input", detail: invalid });
    if (body.model) await deps.recordSpend(env, body.model as string, body.usage as Partial<TokenUsage> | undefined);
    const ok = await deps.fail(body.job_id as number, body.lease_token as string, body.error as string);
    return reply(200, { ok });
  }

  return reply(400, { error: "invalid_input", detail: "body.action must be claim or fail" });
}
