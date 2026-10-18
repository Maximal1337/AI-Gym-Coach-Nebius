import { type ChatOptions, type ChatResult, HermesError, type SandboxEndpoint } from "./hermes.js";
import {
  type ClaimOptions,
  type ClaimResult,
  type DeferRequest,
  type DeliverRequest,
  type FailRequest,
  type JobContext,
  OutboxError,
} from "./outbox.js";
import type { SessionMessage } from "./hermes-session.js";
import { buildMessages, type ChatMessage, isCheckinSkip, replyText } from "./prompt.js";
import { DEFER_SECONDS, type SandboxLease } from "./sandbox-manager.js";
import { replySources, type Source } from "./sources.js";

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
    claim: (limit: number, leaseSeconds: number, options?: ClaimOptions) => Promise<ClaimResult>;
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
  /**
   * The turn read back from its Hermes session (hermes-session.ts), for the
   * reply's sources. Bounded by its own short timeout; without it, or when it
   * fails, a reply has only the links in its text.
   */
  readTurn?: (endpoint: SandboxEndpoint, sessionId: string) => Promise<SessionMessage[]>;
  /** The Token Factory model the sandboxes use, for pricing the spend (D-34). */
  model: string;
  now: () => Date;
  log: (event: string, fields: Record<string, unknown>) => void;
}

const DELIVER_ATTEMPTS = 3;
/**
 * How long after the relay starts a sandbox its Hermes may still be booting:
 * until then a turn that finds nothing listening waits in the queue, unspent,
 * instead of using up the job's attempts. A start takes about 18 s, but now
 * and then OpenShell 0.1.2's supervisor misses its first connection to the
 * gateway and tries again 2 min 16 s later (NH-25): three minutes covers that.
 * The bench allows the same.
 */
export const HERMES_BOOT_MS = 180_000;

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

/**
 * The reply's sources: its own links, then the pages this turn searched
 * (NH-23). Reading the session can only add sources: when it fails, the
 * reply goes out with the links in its text, and the turn is delivered as if
 * nothing had been tried.
 */
async function turnSources(job: JobContext, result: ChatResult, endpoint: SandboxEndpoint, deps: RelayDeps): Promise<Source[]> {
  let turn: SessionMessage[] | undefined;
  if (deps.readTurn && result.sessionId) {
    try {
      turn = await deps.readTurn(endpoint, result.sessionId);
    } catch (e) {
      deps.log("sources_unread", { job: job.id, error: String(e) });
    }
  }
  return replySources(result.text, turn);
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
    ...(skip ? { skip: true } : { reply: { text, sources: await turnSources(job, result, endpoint, deps) } }),
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

export interface Poll {
  outcomes: Outcome[];
  /** The environment is at its spend ceiling (D-34). */
  paused?: string;
}

/** A job claimed while the relay is stopping is claimable again this soon, its attempt unspent. */
export const RELEASE_SECONDS = 1;

/**
 * One poll: claim a batch, waiting for it up to `claim.waitSeconds`, and run
 * it; each user has at most one job in the batch (the queue guarantees it).
 * A batch that arrives once the relay is stopping (`stop` aborted) isn't
 * started: it goes straight back to the queue.
 */
export async function runOnce(
  deps: RelayDeps,
  limit: number,
  leaseSeconds: number,
  claim: ClaimOptions = {},
  stop?: AbortSignal,
): Promise<Poll> {
  const { jobs, paused } = await deps.outbox.claim(limit, leaseSeconds, claim);
  if (paused) deps.log("paused", { reason: paused });
  if (stop?.aborted && jobs.length > 0) {
    await Promise.allSettled(
      jobs.map((job) => deps.outbox.defer({ job_id: job.id, lease_token: job.lease_token, seconds: RELEASE_SECONDS, reason: "relay_stopping" })),
    );
    deps.log("released", { jobs: jobs.map((job) => job.id), reason: "relay_stopping" });
    return { outcomes: jobs.map(() => "deferred"), ...(paused ? { paused } : {}) };
  }
  const now = deps.now().getTime();
  for (const job of jobs) {
    // How long the message waited in the queue: what long polling is for.
    const sent = job.message?.created_at ? Date.parse(job.message.created_at) : NaN;
    deps.log("claimed", { job: job.id, kind: job.job.kind, ...(Number.isFinite(sent) ? { queuedMs: now - sent } : {}) });
  }
  const settled = await Promise.allSettled(jobs.map((job) => processJob(job, deps)));
  const outcomes = settled.map((s, i): Outcome => {
    if (s.status === "fulfilled") return s.value;
    // Reporting itself failed; the lease will expire and the job will be retried.
    deps.log("job_error", { job: jobs[i].id, error: String(s.reason) });
    return "failed";
  });
  return { outcomes, ...(paused ? { paused } : {}) };
}

export interface PollConfig {
  batch: number;
  leaseSeconds: number;
  /** How long assistant-outbox may hold a claim open for a job (long polling); 0 is one look. */
  waitSeconds: number;
  /** The pause after an answer that came back fast and empty, or after an error. */
  idlePauseMs: number;
}

/**
 * An empty answer quicker than this didn't wait — the spend ceiling, or a
 * function that doesn't long-poll — so the next claim waits idlePauseMs first,
 * instead of the relay calling in a tight loop. An empty answer that took
 * the whole wait is followed by the next claim at once.
 */
export const FAST_ANSWER_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
const STATS_EVERY_MS = 3_600_000;

export interface LoopIO {
  /** Resolves after ms, or at once when signal aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** "The loop is turning", for the liveness probe. */
  heartbeat: () => Promise<void>;
}

/** Resolves after ms, or as soon as signal aborts. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * The relay's loop: claim, run, repeat, until `stop` aborts. Stopping doesn't
 * cut short a claim that is waiting: assistant-outbox doesn't notice a dropped
 * request, and would lease a job that arrives after to nobody until the lease
 * runs out. The claim comes back within its wait instead, and whatever it
 * brings goes back to the queue unspent. A batch already running finishes
 * first. Once an hour it logs how many claims it made — each one an Edge
 * Function call.
 */
export async function pollLoop(deps: RelayDeps, config: PollConfig, stop: AbortSignal, io: LoopIO): Promise<void> {
  let backoffMs = 1_000;
  let stats = { since: deps.now().getTime(), claims: 0, withJobs: 0, empty: 0, fast: 0, errors: 0 };
  while (!stop.aborted) {
    // Written on every turn of the loop, failed polls included, so the
    // liveness probe restarts a stuck relay but not one waiting out an outage.
    await io.heartbeat();
    const started = deps.now().getTime();
    if (started - stats.since >= STATS_EVERY_MS) {
      deps.log("outbox_claims", { ...stats, minutes: Math.round((started - stats.since) / 60_000) });
      stats = { since: started, claims: 0, withJobs: 0, empty: 0, fast: 0, errors: 0 };
    }
    stats.claims++;
    try {
      const poll = await runOnce(deps, config.batch, config.leaseSeconds, { waitSeconds: config.waitSeconds }, stop);
      backoffMs = 1_000;
      if (poll.outcomes.length > 0) {
        stats.withJobs++;
        deps.log("batch", { outcomes: poll.outcomes });
        continue;
      }
      stats.empty++;
      if (poll.paused !== undefined || deps.now().getTime() - started < FAST_ANSWER_MS) {
        stats.fast++;
        await io.sleep(config.idlePauseMs, stop);
      }
    } catch (e) {
      // Stopping: no retry.
      if (stop.aborted) break;
      stats.errors++;
      const retryInMs = Math.min(BACKOFF_MAX_MS, Math.max(backoffMs, config.idlePauseMs));
      deps.log("poll_error", { error: String(e), retryInMs });
      await io.sleep(retryInMs, stop);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    }
  }
}
