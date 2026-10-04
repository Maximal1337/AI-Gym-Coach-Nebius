import type { ChatMessage } from "./prompt.js";
import type { Usage } from "./outbox.js";

/**
 * Calls a user's Hermes agent through its OpenAI-compatible API server
 * (`/v1/chat/completions`, bearer key per sandbox). The sandbox is reached on
 * the cluster network only; nothing about it is exposed outside the VPS.
 */

export interface SandboxEndpoint {
  /** e.g. http://10.42.0.17:8642 */
  baseUrl: string;
  apiKey: string;
}

export interface ChatResult {
  text: string;
  usage?: Usage;
}

export class HermesError extends Error {
  /**
   * mayHaveSpent: the model may already have run (and spent tokens) before the failure.
   * notReady: nothing was listening — a refused connection, or the gateway's 502/503
   * for a sandbox port that isn't open yet. Hermes' API server comes up some time
   * after its sandbox does.
   */
  constructor(message: string, readonly mayHaveSpent: boolean, readonly notReady = false) {
    super(message);
    this.name = "HermesError";
  }
}

export interface ChatOptions {
  /** Stable per user, so Hermes scopes long-term memory to them even across sessions. */
  sessionKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

function usageFrom(body: Record<string, unknown>): Usage | undefined {
  const u = body.usage as Record<string, unknown> | undefined;
  const input = u?.prompt_tokens;
  const output = u?.completion_tokens;
  if (Number.isInteger(input) && Number.isInteger(output)) return { tokensInput: input as number, tokensOutput: output as number };
  return undefined;
}

export async function chat(endpoint: SandboxEndpoint, messages: ChatMessage[], options: ChatOptions): Promise<ChatResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(`${endpoint.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${endpoint.apiKey}`,
        "x-hermes-session-key": options.sessionKey,
      },
      body: JSON.stringify({ model: "hermes-agent", messages, stream: false }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    // A timeout means the agent was running; a refused connection means it never started.
    throw new HermesError(timedOut ? `hermes timed out after ${options.timeoutMs} ms` : `hermes unreachable: ${String(e)}`, timedOut, !timedOut);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // 4xx is refused before the model runs (auth, bad request, too many runs); 5xx may be mid-turn.
    throw new HermesError(`hermes ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, res.status >= 500, res.status === 502 || res.status === 503);
  }
  const choice = (body.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0];
  const text = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
  if (!text) throw new HermesError("hermes returned an empty reply", true);
  return { text, usage: usageFrom(body) };
}
