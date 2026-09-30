import { type ChatOptions, type ChatResult, HermesError, type SandboxEndpoint } from "./hermes.js";
import type { DeferRequest, DeliverRequest, FailRequest, JobContext } from "./outbox.js";
import { buildMessages, CHECKIN_SKIP, type ChatMessage, extractSources, replyText } from "./prompt.js";
import type { SandboxLease } from "./sandbox-manager.js";

/**
 * The relay (NH-54): pulls jobs from Supabase, runs each one in its user's own
 * sandbox, and reports the result. One sandbox per user (D-26) — the relay
 * never routes a user's message anywhere but that user's endpoint, and a user
 * without a ready sandbox waits (the job is deferred: back to the queue with
 * its attempt unspent) rather than being served from somewhere shared.
 */

export type Outcome = "delivered" | "skipped" | "failed" | "dropped" | "deferred";

export interface RelayDeps {
  outbox: {
    claim: (limit: number, leaseSeconds: number) => Promise<{ jobs: JobContext[]; paused?: string }>;
    deliver: (request: DeliverRequest) => Promise<{ status: number; body: Record<string, unknown> }>;
    fail: (request: FailRequest) => Promise<boolean>;
    defer: (request: DeferRequest) => Promise<boolean>;
  };
  /**
   * The user's own sandbox for this job, released when the job is done — or
   * how long to wait (the sandbox manager, NH-55; a static map in the spike).
   * Throws when the sandbox can't be provided at all.
   */
  acquireSandbox: (job: JobContext) => Promise<SandboxLease>;
  chat: (endpoint: SandboxEndpoint, messages: ChatMessage[], options: Pick<ChatOptions, "sessionKey">) => Promise<ChatResult>;
  /** The Token Factory model the sandboxes use, for pricing the spend (D-34). */
  model: string;
  now: () => Date;
  log: (event: string, fields: Record<string, unknown>) => void;
}

const DELIVER_ATTEMPTS = 3;

async function deliverWithRetry(deps: RelayDeps, request: DeliverRequest): Promise<number> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DELIVER_ATTEMPTS; attempt++) {
    try {
      return (await deps.outbox.deliver(request)).status;
    } catch (e) {
      // Safe to retry: a delivery is idempotent per job (assistant_complete_job).
      lastError = e;
    }
  }
  throw lastError;
}

export async function processJob(job: JobContext, deps: RelayDeps): Promise<Outcome> {
  const base = { job_id: job.id, lease_token: job.lease_token };
  let lease: SandboxLease;
  try {
    lease = await deps.acquireSandbox(job);
  } catch (e) {
    // Nothing reached the model, so nothing is charged; the attempt counts.
    deps.log("sandbox_error", { job: job.id, error: String(e) });
    await deps.outbox.fail({ ...base, error: `sandbox_error: ${String(e)}`.slice(0, 2000) });
    return "failed";
  }
  if ("defer" in lease) {
    deps.log("deferred", { job: job.id, reason: lease.reason, seconds: lease.defer });
    await deps.outbox.defer({ ...base, seconds: lease.defer, reason: lease.reason });
    return "deferred";
  }
  try {
    return await runInSandbox(job, lease.endpoint, deps);
  } finally {
    lease.release();
  }
}

async function runInSandbox(job: JobContext, endpoint: SandboxEndpoint, deps: RelayDeps): Promise<Outcome> {
  const base = { job_id: job.id, lease_token: job.lease_token };
  let result: ChatResult;
  try {
    result = await deps.chat(endpoint, buildMessages(job, deps.now()), { sessionKey: job.job.user_id });
  } catch (e) {
    const spent = e instanceof HermesError ? e.mayHaveSpent : true;
    deps.log("turn_failed", { job: job.id, error: String(e), spent });
    await deps.outbox.fail({ ...base, error: String(e), ...(spent ? { model: deps.model } : {}) });
    return "failed";
  }

  const skip = job.job.kind === "checkin" && result.text.trim() === CHECKIN_SKIP;
  const request: DeliverRequest = {
    ...base,
    model: deps.model,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(skip ? { skip: true } : { reply: { text: replyText(result.text), sources: extractSources(result.text) } }),
  };
  const status = await deliverWithRetry(deps, request);
  if (status !== 200) {
    // 409: the lease expired and another attempt owns the job; 404: the job is gone (user deleted).
    deps.log("delivery_dropped", { job: job.id, status });
    return "dropped";
  }
  return skip ? "skipped" : "delivered";
}

/** One poll: claim a batch and run it; each user has at most one job in the batch (the queue guarantees it). */
export async function runOnce(deps: RelayDeps, limit: number, leaseSeconds: number): Promise<Outcome[]> {
  const { jobs, paused } = await deps.outbox.claim(limit, leaseSeconds);
  if (paused) deps.log("paused", { reason: paused });
  const settled = await Promise.allSettled(jobs.map((job) => processJob(job, deps)));
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    // Reporting itself failed; the lease will expire and the job will be retried.
    deps.log("job_error", { job: jobs[i].id, error: String(s.reason) });
    return "failed";
  });
}
