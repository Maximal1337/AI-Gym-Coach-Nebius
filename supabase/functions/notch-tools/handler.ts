import { handleMcp, JSONRPC, type McpServer } from "../_shared/mcp.ts";

/**
 * HTTP layer of notch-tools (NH-42): authentication and the MCP Streamable
 * HTTP transport rules, with every external check injected so the boundary
 * can be tested without Supabase. index.ts wires in the real dependencies.
 *
 * Order of checks, each one failing closed:
 *  1. Origin — a browser origin that isn't allowlisted gets 403 (the MCP
 *     spec's DNS-rebinding rule). Hermes sends no Origin header.
 *  2. Method — only POST; there is no server-initiated SSE stream (GET 405).
 *  3. Bearer tool token → user id (unknown or malformed → 401).
 *  4. The user's assistant_chat flag, which is also the kill switch (→ 403).
 *  5. JSON-RPC — rate limits and entitlement run per tool call, in
 *     McpServer.beforeCall.
 */
export interface ToolsDeps<Ctx> {
  server: McpServer<Ctx>;
  resolveUser: (token: string) => Promise<string | null>;
  isEnabled: (userId: string) => Promise<boolean>;
  context: (userId: string) => Ctx;
  allowedOrigins: readonly string[];
}

export const MAX_BODY_BYTES = 64 * 1024;

export function bearerToken(req: Request): string | null {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

export async function handleToolsRequest<Ctx>(req: Request, deps: ToolsDeps<Ctx>): Promise<Response> {
  const origin = req.headers.get("origin");
  const originAllowed = !origin || deps.allowedOrigins.includes(origin);
  const headers: Record<string, string> = { "content-type": "application/json", "vary": "Origin" };
  if (origin && originAllowed) headers["access-control-allow-origin"] = origin;
  const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...headers, ...extra } });

  if (!originAllowed) return reply(403, { error: "origin_not_allowed" });
  if (req.method === "OPTIONS") {
    return reply(204, null, {
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
    });
  }
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, { allow: "POST" });

  const token = bearerToken(req);
  const userId = token ? await deps.resolveUser(token) : null;
  if (!userId) return reply(401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="notch-tools"' });
  if (!(await deps.isEnabled(userId))) return reply(403, { error: "assistant_disabled" });

  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reply(413, { error: "payload_too_large" });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { jsonrpc: "2.0", id: null, error: { code: JSONRPC.parseError, message: "Parse error" } });
  }

  const result = await handleMcp(deps.server, body, deps.context(userId));
  return result === null ? reply(202, null) : reply(200, result);
}
