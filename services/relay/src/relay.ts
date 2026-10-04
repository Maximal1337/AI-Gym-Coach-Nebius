import { type ChatOptions, type ChatResult, HermesError, type SandboxEndpoint } from "./hermes.js";
import { type DeferRequest, type DeliverRequest, type FailRequest, type JobContext, OutboxError } from "./outbox.js";
import { buildMessages, type ChatMessage, extractSources, isCheckinSkip, replyText } from "./prompt.js";
import { DEFER_SECONDS, type SandboxLease } from "./sandbox-manager.js";

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
/**
 * How long after the relay starts a sandbox its Hermes may still be booting:
 * until then a turn that finds nothing listening waits in the queue, unspent,
 * instead of using up the job's attempts. The bench allows the same two minutes.
 */
export const HERMES_BOOT_MS = 120_000;

async function deliverWithRetry(deps: RelayDeps, request: DeliverRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DELIVER_ATTEMPTS; attempt++) {
    try {
      return await deps.outbox.deliver(request);
    } catch (e) {
      // Safe to retry: a delivery is idempotent per job (assistant_complete_job).
      // A request refused as invalid would only be refused again.
      if (e instanceof OutboxError && e.status === 400) throw e;
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
    return await runInSandbox(job, lease.endpoint, lease.startedAt, deps);
  } finally {
    lease.release();
  }
}

async function runInSandbox(job: JobContext, endpoint: SandboxEndpoint, startedAt: number | undefined, deps: RelayDeps): Promise<Outcome> {
  const base = { job_id: job.id, lease_token: job.lease_token };
  let result: ChatResult;
  try {
    result = await deps.chat(endpoint, buildMessages(job, deps.now()), { sessionKey: job.job.user_id });
  } catch (e) {
    if (e instanceof HermesError && e.notReady && startedAt !== undefined && deps.now().getTime() - startedAt < HERMES_BOOT_MS) {
      deps.log("deferred", { job: job.id, reason: "hermes_starting", seconds: DEFER_SECONDS.busy });
      await deps.outbox.defer({ ...base, seconds: DEFER_SECONDS.busy, reason: "hermes_starting" });
      return "deferred";
    }
    const spent = e instanceof HermesError ? e.mayHaveSpent : true;
    const usage = e instanceof HermesError ? e.usage : undefined;
    deps.log("turn_failed", { job: job.id, error: String(e), spent });
    await deps.outbox.fail({ ...base, error: String(e), ...(spent ? { model: deps.model, ...(usage ? { usage } : {}) } : {}) });
    return "failed";
  }

  // From here on the model has run: every way out charges the turn (D-34).
  const charge = { model: deps.model, ...(result.usage ? { usage: result.usage } : {}) };
  const skip = job.job.kind === "checkin" && isCheckinSkip(result.text);
  const text = skip ? "" : replyText(result.text);
  if (!skip && !text) {
    // Nothing storable was left (the reply was only NUL characters), which
    // deliver would refuse: the same as an empty reply from Hermes.
    deps.log("turn_failed", { job: job.id, error: "empty reply", spent: true });
    await deps.outbox.fail({ ...base, error: "hermes returned an empty reply", ...charge });
    return "failed";
  }
  const request: DeliverRequest = {
    ...base,
    ...charge,
    ...(skip ? { skip: true } : { reply: { text, sources: extractSources(result.text) } }),
  };
  let delivery: { status: number; body: Record<string, unknown> };
  try {
    delivery = await deliverWithRetry(deps, request);
  } catch (e) {
    // Refused as invalid (400), it would be refused again; any other error has
    // already been retried. Either way, report the attempt with its spend
    // rather than let the lease run out and the turn go unrecorded. Should a
    // retried attempt have reached the database after all, its response lost,
    // the job is done already and the charge counts twice: an overcount,
    // never a lost one.
    const refused = e instanceof OutboxError && e.status === 400;
    deps.log(refused ? "delivery_refused" : "delivery_failed", { job: job.id, error: String(e) });
    await deps.outbox.fail({ ...base, error: `${refused ? "delivery_refused" : "delivery_failed"}: ${String(e)}`, ...charge });
    return "failed";
  }
  const refusal = delivery.body.error;
  if ((delivery.status === 409 && refusal === "lease_lost") || (delivery.status === 404 && refusal === "job_not_found")) {
    // The lease was lost to another attempt, or the job is gone (user
    // deleted). assistant-deliver charged the turn all the same.
    deps.log("delivery_dropped", { job: job.id, status: delivery.status });
    return "dropped";
  }
  if (delivery.status !== 200) {
    // A 404 or 409 that isn't assistant-deliver's own answer (the function not
    // deployed, say): nothing charged the turn. Charge it and put the job back.
    const detail = JSON.stringify(delivery.body).slice(0, 300);
    deps.log("delivery_refused", { job: job.id, status: delivery.status, detail });
    await deps.outbox.fail({ ...base, error: `delivery_refused: ${delivery.status} ${detail}`, ...charge });
    return "failed";
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
