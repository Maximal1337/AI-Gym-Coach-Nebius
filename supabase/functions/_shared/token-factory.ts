import type { TokenUsage } from "./assistant.ts";

/**
 * Minimal client for Nebius Token Factory's OpenAI-compatible chat API, for
 * the jobs Supabase runs itself (the nightly memory job, NH-63). The agent's
 * own turns go through the sandboxes, not through here.
 *
 * Retries 429, 5xx and network errors with backoff; other 4xx fail at once.
 * A timeout isn't retried: the model was running, so a retry would pay for
 * the turn again and take another full timeout. With a deadline, no retry
 * starts that couldn't end before it. Retried attempts that may have spent
 * (a 5xx) are counted in `retriedSpent`, on the result and on the error, so
 * the caller can charge them.
 * A reply whose content is empty while reasoning came back is the known
 * reasoning-model failure (D-03: thinking spent the token budget) and fails
 * loudly instead of being parsed as nothing.
 */

export const TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1";

export interface TokenFactoryRequest {
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** Asks for JSON matching this schema (response_format json_schema); the caller still validates. */
  jsonSchema?: { name: string; schema: unknown };
  maxTokens?: number;
  /** "none" turns thinking off (interactive turns); omit to keep the model's default. */
  reasoningEffort?: "none" | "low" | "medium" | "high";
  baseUrl?: string;
  timeoutMs?: number;
  /** Backoff before each retry; its length is the number of retries. */
  backoffMs?: number[];
  /** Epoch ms the call must be over by: a retry that couldn't finish within its timeout isn't started. */
  deadlineMs?: number;
  now?: () => number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface TokenFactoryResult {
  content: string;
  usage?: TokenUsage;
  model: string;
  /** Earlier attempts that failed after the model may have run, each still to be charged. */
  retriedSpent?: number;
}

export class TokenFactoryError extends Error {
  /** Earlier attempts that failed after the model may have run; this one is `spent`. */
  retriedSpent = 0;
  constructor(message: string, readonly status: number | null, readonly spent: boolean) {
    super(message);
    this.name = "TokenFactoryError";
  }
}

const retryable = (status: number) => status === 429 || status >= 500;

export async function tokenFactoryChat(req: TokenFactoryRequest): Promise<TokenFactoryResult> {
  const doFetch = req.fetch ?? globalThis.fetch;
  const sleep = req.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = req.now ?? Date.now;
  const backoff = req.backoffMs ?? [1_000, 3_000];
  const timeoutMs = req.timeoutMs ?? 90_000;
  const body = JSON.stringify({
    model: req.model,
    messages: req.messages,
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    ...(req.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema } } } : {}),
  });

  let lastError: TokenFactoryError | undefined;
  let retriedSpent = 0;
  const failed = (e: TokenFactoryError) => Object.assign(e, { retriedSpent });
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt > 0) {
      if (req.deadlineMs !== undefined && now() + backoff[attempt - 1] + timeoutMs > req.deadlineMs) break;
      if (lastError?.spent) retriedSpent++;
      await sleep(backoff[attempt - 1]);
    }
    let res: Response;
    try {
      res = await doFetch(`${req.baseUrl ?? TOKEN_FACTORY_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${req.apiKey}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (timedOut) throw failed(new TokenFactoryError(`token factory timed out: ${String(e)}`, null, true));
      lastError = new TokenFactoryError(`token factory unreachable: ${String(e)}`, null, false);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      lastError = new TokenFactoryError(`token factory ${res.status}: ${JSON.stringify(json).slice(0, 300)}`, res.status, res.status >= 500);
      if (retryable(res.status)) continue;
      throw failed(lastError);
    }
    const message = (json.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0]?.message ?? {};
    const content = typeof message.content === "string" ? message.content.trim() : "";
    const u = json.usage as Record<string, unknown> | undefined;
    const usage = Number.isInteger(u?.prompt_tokens) && Number.isInteger(u?.completion_tokens)
      ? { tokensInput: u!.prompt_tokens as number, tokensOutput: u!.completion_tokens as number }
      : undefined;
    if (!content) {
      const reasoningOnly = typeof message.reasoning_content === "string" && message.reasoning_content.length > 0;
      // Not retried: the same budget would fail the same way.
      throw Object.assign(
        failed(new TokenFactoryError(reasoningOnly ? "empty content: reasoning used the whole budget" : "empty content", res.status, true)),
        { usage },
      );
    }
    return { content, usage, model: typeof json.model === "string" ? json.model : req.model, ...(retriedSpent ? { retriedSpent } : {}) };
  }
  throw failed(lastError!);
}
