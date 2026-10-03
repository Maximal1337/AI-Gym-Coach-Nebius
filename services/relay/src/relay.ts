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
  /**
   * How much of its lease a job needs left to start its turn: the turn
   * timeout plus DELIVERY_MARGIN_MS (main.ts). A reply delivered after the
   * lease ran out is dropped, so a job whose sandbox took longer than that to
   * get ready is deferred instead: the sandbox is warm by then, and the next
   * claim runs the job at once on a fresh lease.
   */
  turnBudgetMs: number;
  now: () => Date;
  log: (event: string, fields: Record<string, unknown>) => void;
}

const DELIVER_ATTEMPTS = 3;
/** Time a turn's delivery may take on top of the turn timeout. */
export const DELIVERY_MARGIN_MS = 15_000;
/** How long a job deferred for lack of lease waits: its sandbox is ready, so hardly at all. */
export const LEASE_SHORT_DEFER_SECONDS = 2;
/** What a lease must leave for getting the sandbox on top of the turn budget. */
export const MIN_ACQUIRE_MS = 30_000;
/** The leases assistant-outbox grants: lease_seconds in its CLAIM_SCHEMA, a whole number of seconds. */
export const LEASE_SECONDS_RANGE = { min: 30, max: 900 } as const;

/**
 * RelayDeps.turnBudgetMs for a turn timeout. Throws for a lease that
 * assistant-outbox would refuse, or that leaves under MIN_ACQUIRE_MS to get
 * the sandbox: either way the relay would run and never answer anyone.
 */
export function turnBudget(leaseSeconds: number, turnTimeoutMs: number): number {
  const { min, max } = LEASE_SECONDS_RANGE;
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < min || leaseSeconds > max) {
    throw new Error(`RELAY_LEASE_SECONDS (${leaseSeconds}) must be a whole number from ${min} to ${max}`);
  }
  const budgetMs = turnTimeoutMs + DELIVERY_MARGIN_MS;
  const minimum = Math.ceil((budgetMs + MIN_ACQUIRE_MS) / 1000);
  if (minimum > max) throw new Error(`RELAY_TURN_TIMEOUT_MS (${turnTimeoutMs}) is too long for any lease up to ${max} s`);
  if (leaseSeconds < minimum) {
    throw new Error(`RELAY_LEASE_SECONDS (${leaseSeconds}) must be at least ${minimum} with RELAY_TURN_TIMEOUT_MS ${turnTimeoutMs}`);
  }
  return budgetMs;
}

async function deliverWithRetry(deps: RelayDeps, request: DeliverRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DELIVER_ATTEMPTS; attempt++) {
    try {
      return await deps.outbox.deliver(request);
    } catch (e) {
      // Safe to retry: a delivery is idempotent per job (assistant_complete_job).
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * Runs one leased job. `deadline` (epoch ms, the relay's clock) is when its
 * lease runs out, taken before the claim so it's never later than the real
 * one; runOnce passes it.
 */
export async function processJob(job: JobContext, deps: RelayDeps, deadline = Number.POSITIVE_INFINITY): Promise<Outcome> {
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
    // Getting the sandbox ate into the lease (a cold start, or waiting behind
    // another job's): with too little left, the turn's reply would be dropped
    // after its tokens were spent. Hand the job back unspent instead.
    const leftMs = deadline - deps.now().getTime();
    if (leftMs < deps.turnBudgetMs) {
      deps.log("deferred", { job: job.id, reason: "lease_short", seconds: LEASE_SHORT_DEFER_SECONDS, leftMs });
      await deps.outbox.defer({ ...base, seconds: LEASE_SHORT_DEFER_SECONDS, reason: "lease_short" });
      return "deferred";
    }
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

  // From here on the model has run: every way out charges the turn (D-34).
  const charge = { model: deps.model, ...(result.usage ? { usage: result.usage } : {}) };
  const skip = job.job.kind === "checkin" && result.text.trim() === CHECKIN_SKIP;
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
    // Every attempt failed. fail charges the turn and puts the job back. Should
    // an attempt have reached assistant-deliver after all, its response lost,
    // the turn may be charged more than once: an overcount, never a lost one.
    deps.log("delivery_failed", { job: job.id, error: String(e) });
    await deps.outbox.fail({ ...base, error: `delivery_failed: ${String(e)}`, ...charge });
    return "failed";
  }
  const refusal = delivery.body.error;
  if ((delivery.status === 409 && refusal === "lease_lost") || (delivery.status === 404 && refusal === "job_not_found")) {
    // The lease expired and another attempt owns the job, or the job is gone
    // (user deleted). assistant-deliver charged the turn all the same.
    deps.log("delivery_dropped", { job: job.id, status: delivery.status });
    return "dropped";
  }
  if (delivery.status !== 200) {
    // Refused as invalid (400), or a 404/409 that isn't assistant-deliver's
    // own answer (the function not deployed, say): nothing charged the turn,
    // and the same request would be refused again. Charge it and put the job back.
    const detail = JSON.stringify(delivery.body).slice(0, 300);
    deps.log("delivery_rejected", { job: job.id, status: delivery.status, detail });
    await deps.outbox.fail({ ...base, error: `delivery_rejected: ${delivery.status} ${detail}`, ...charge });
    return "failed";
  }
  return skip ? "skipped" : "delivered";
}

/** One poll: claim a batch and run it; each user has at most one job in the batch (the queue guarantees it). */
export async function runOnce(deps: RelayDeps, limit: number, leaseSeconds: number): Promise<Outcome[]> {
  // Read before the claim, so it's never later than the leases' own end
  // whatever the skew between this clock and the database's.
  const deadline = deps.now().getTime() + leaseSeconds * 1000;
  const { jobs, paused } = await deps.outbox.claim(limit, leaseSeconds);
  if (paused) deps.log("paused", { reason: paused });
  const settled = await Promise.allSettled(jobs.map((job) => processJob(job, deps, deadline)));
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    // Reporting itself failed; the lease will expire and the job will be retried.
    deps.log("job_error", { job: jobs[i].id, error: String(s.reason) });
    return "failed";
  });
}
