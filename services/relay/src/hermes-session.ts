import { apiKeyHeaders, type SandboxEndpoint } from "./hermes.js";

/**
 * Reads one turn back from its Hermes session: what the agent did after the
 * turn's own user message — its tool calls and their results, oldest first.
 * The one place the relay reads a session (the reply's sources now, NH-23);
 * Hermes keeps it in the sandbox's state.db and serves it on its API server
 * (`/api/sessions/<id>/messages`), behind the same key as the turn.
 *
 * Bounded by a short timeout and never trusted: the results are what web
 * pages and tools returned. A failure is the caller's to ignore.
 */

export interface SessionMessage {
  role: string;
  content?: unknown;
  tool_name?: string;
  tool_calls?: Array<{ function?: { name?: string } }>;
  timestamp?: number;
}

export const SESSION_READ_TIMEOUT_MS = 3_000;
/** Enough for a turn's calls and results; a turn needs a handful. */
const MESSAGES_LIMIT = 60;

/** The ids Hermes issues (`api-…`): anything else isn't put into a URL. */
export function isSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export async function readTurn(
  endpoint: SandboxEndpoint,
  sessionId: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<SessionMessage[]> {
  if (!isSessionId(sessionId)) throw new Error("not a Hermes session id");
  const doFetch = options.fetch ?? globalThis.fetch;
  const res = await doFetch(`${endpoint.baseUrl}/api/sessions/${sessionId}/messages?order=latest&limit=${MESSAGES_LIMIT}`, {
    headers: apiKeyHeaders(endpoint.apiKey),
    signal: AbortSignal.timeout(options.timeoutMs ?? SESSION_READ_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`hermes session ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) throw new Error("hermes session: no messages");
  const latestFirst = (body.data as SessionMessage[])
    .filter((m) => m && typeof m.role === "string")
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  // Everything after the turn's own user message. None among the latest
  // messages: the turn alone filled the page, and all of it is this turn's.
  const cut = latestFirst.findIndex((m) => m.role === "user");
  return (cut < 0 ? latestFirst : latestFirst.slice(0, cut)).reverse();
}
