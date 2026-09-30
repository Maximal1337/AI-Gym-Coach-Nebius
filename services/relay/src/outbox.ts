import { type RelayEnvironment, relayHeaders } from "./signing.js";

/**
 * Client for the Supabase side of the channel: assistant-outbox (claim, fail)
 * and assistant-deliver. Every request is signed for this relay's environment.
 * The VPS only ever makes outbound calls (D-27).
 */

export interface JobContext {
  id: number;
  lease_token: string;
  leased_until: string;
  job: { id: number; kind: "chat" | "checkin"; environment: RelayEnvironment; user_id: string; attempts: number };
  message: { id: string; text: string; created_at: string } | null;
  history: Array<{ role: "user" | "assistant"; text: string; created_at: string }>;
  facts: Array<{ text: string; category: string; pinned: boolean }>;
  user: { language: string | null; units: "metric" | "imperial" | null; coach_name: string | null; tone: string | null } | null;
  agent: { sandbox_name: string | null; provisioned: boolean } | null;
}

export interface Usage {
  tokensInput: number;
  tokensOutput: number;
}

export interface DeliverRequest {
  job_id: number;
  lease_token: string;
  model: string;
  usage?: Usage;
  skip?: boolean;
  reply?: { text: string; sources?: Array<{ title?: string; url: string }> };
}

export interface FailRequest {
  job_id: number;
  lease_token: string;
  error: string;
  /** Set only when the model may have been called, so the attempt's tokens are charged. */
  model?: string;
  usage?: Usage;
}

export interface OutboxConfig {
  /** e.g. https://<project-ref>.supabase.co/functions/v1 */
  functionsUrl: string;
  env: RelayEnvironment;
  secret: string;
  fetch?: typeof fetch;
  nowSec?: () => number;
}

/** Per request to assistant-outbox / assistant-deliver; both answer in well under a second. */
export const OUTBOX_TIMEOUT_MS = 30_000;

export class OutboxError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "OutboxError";
  }
}

export class OutboxClient {
  private readonly fetch: typeof fetch;
  private readonly nowSec: () => number;

  constructor(private readonly config: OutboxConfig) {
    this.fetch = config.fetch ?? globalThis.fetch;
    this.nowSec = config.nowSec ?? (() => Math.floor(Date.now() / 1000));
  }

  private async post(fn: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const body = JSON.stringify(payload);
    const res = await this.fetch(`${this.config.functionsUrl}/${fn}`, {
      method: "POST",
      headers: relayHeaders(this.config.secret, this.config.env, body, this.nowSec()),
      body,
      // A hung request would stall the whole poll loop; the liveness probe
      // restarts a stalled relay (deploy/notch/base/relay.yaml), this keeps it rare.
      signal: AbortSignal.timeout(OUTBOX_TIMEOUT_MS),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: parsed };
  }

  async claim(limit: number, leaseSeconds: number): Promise<{ jobs: JobContext[]; paused?: string }> {
    const { status, body } = await this.post("assistant-outbox", { action: "claim", limit, lease_seconds: leaseSeconds });
    if (status !== 200) throw new OutboxError(`claim failed: ${status} ${JSON.stringify(body)}`, status);
    return { jobs: (body.jobs ?? []) as JobContext[], paused: body.paused as string | undefined };
  }

  async fail(request: FailRequest): Promise<boolean> {
    const { status, body } = await this.post("assistant-outbox", { action: "fail", ...request, error: request.error.slice(0, 2000) });
    if (status !== 200) throw new OutboxError(`fail failed: ${status} ${JSON.stringify(body)}`, status);
    return body.ok === true;
  }

  /** 200 delivered / skipped / already_delivered, 409 lease_lost, 404 job_not_found; throws on anything else. */
  async deliver(request: DeliverRequest): Promise<{ status: number; body: Record<string, unknown> }> {
    const result = await this.post("assistant-deliver", request);
    if (result.status !== 200 && result.status !== 409 && result.status !== 404) {
      throw new OutboxError(`deliver failed: ${result.status} ${JSON.stringify(result.body)}`, result.status);
    }
    return result;
  }
}
