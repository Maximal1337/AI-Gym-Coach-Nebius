// HTTP boundary tests for notch-tools (NH-42). Run: deno test --no-config supabase/functions/
import { assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import { type McpServer, ToolError } from "../_shared/mcp.ts";
import { bearerToken, handleToolsRequest, MAX_BODY_BYTES, NOT_SUBSCRIBED, RATE_LIMITED, toolGate, type ToolsDeps } from "./handler.ts";

interface Ctx {
  userId: string;
}

const TOKEN = "t".repeat(43);
const server: McpServer<Ctx> = {
  name: "notch-tools",
  version: "0.1.0",
  tools: [{
    name: "whoami",
    description: "Returns the caller",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    handler: (_args, ctx) => Promise.resolve({ user: ctx.userId }),
  }],
};

function deps(overrides: Partial<ToolsDeps<Ctx>> = {}) {
  const seen = { resolved: [] as string[], enabledChecks: 0 };
  const d: ToolsDeps<Ctx> = {
    server,
    resolveUser: (token) => {
      seen.resolved.push(token);
      return Promise.resolve(token === TOKEN ? "user-1" : null);
    },
    isEnabled: () => {
      seen.enabledChecks++;
      return Promise.resolve(true);
    },
    context: (userId) => ({ userId }),
    allowedOrigins: [],
    ...overrides,
  };
  return { d, seen };
}

function post(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return new Request("https://example.test/functions/v1/notch-tools", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const callWhoami = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "whoami", arguments: {} } };

Deno.test("a valid token reaches the tools, as that token's user", async () => {
  const { d } = deps();
  const res = await handleToolsRequest(post(callWhoami), d);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.result.structuredContent, { user: "user-1" });
});

Deno.test("no token, a wrong token or a non-Bearer scheme is 401 — and never reaches the flag check", async () => {
  const cases: Record<string, string>[] = [
    {},
    { authorization: "Bearer wrong-token-wrong-token-wrong-token" },
    { authorization: `Basic ${TOKEN}` },
  ];
  for (const headers of cases) {
    const { d, seen } = deps();
    const res = await handleToolsRequest(post(callWhoami, headers), d);
    assertEquals(res.status, 401, JSON.stringify(headers));
    assertEquals(res.headers.get("www-authenticate"), 'Bearer realm="notch-tools"');
    assertEquals(seen.enabledChecks, 0);
  }
});

Deno.test("a user whose assistant is switched off gets 403", async () => {
  const { d } = deps({ isEnabled: () => Promise.resolve(false) });
  const res = await handleToolsRequest(post(callWhoami), d);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "assistant_disabled" });
});

Deno.test("an unknown browser origin is refused before anything else", async () => {
  const { d, seen } = deps();
  const res = await handleToolsRequest(post(callWhoami, { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" }), d);
  assertEquals(res.status, 403);
  assertEquals(seen.resolved.length, 0);
});

Deno.test("an allowlisted origin is served and echoed back", async () => {
  const { d } = deps({ allowedOrigins: ["https://notch.app"] });
  const res = await handleToolsRequest(post(callWhoami, { authorization: `Bearer ${TOKEN}`, origin: "https://notch.app" }), d);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), "https://notch.app");
});

Deno.test("GET and DELETE are 405: there is no server-initiated stream or session", async () => {
  const { d } = deps();
  for (const method of ["GET", "DELETE"]) {
    const res = await handleToolsRequest(new Request("https://example.test/", { method, headers: { authorization: `Bearer ${TOKEN}` } }), d);
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("allow"), "POST");
  }
});

Deno.test("OPTIONS is answered without authentication", async () => {
  const { d, seen } = deps();
  const res = await handleToolsRequest(new Request("https://example.test/", { method: "OPTIONS" }), d);
  assertEquals(res.status, 204);
  assertEquals(seen.resolved.length, 0);
});

Deno.test("a notification is 202 with no body", async () => {
  const { d } = deps();
  const res = await handleToolsRequest(post({ jsonrpc: "2.0", method: "notifications/initialized" }), d);
  assertEquals(res.status, 202);
  assertEquals(await res.text(), "");
});

Deno.test("unparseable JSON is a 400 JSON-RPC parse error", async () => {
  const { d } = deps();
  const res = await handleToolsRequest(post("{not json"), d);
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, -32700);
});

Deno.test("an oversized body is 413", async () => {
  const { d } = deps();
  const res = await handleToolsRequest(post({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(MAX_BODY_BYTES) } }), d);
  assertEquals(res.status, 413);
});

Deno.test("bearerToken parses only a single Bearer credential", () => {
  const req = (v?: string) => new Request("https://example.test/", v ? { headers: { authorization: v } } : {});
  assertEquals(bearerToken(req(`Bearer ${TOKEN}`)), TOKEN);
  assertEquals(bearerToken(req(`bearer ${TOKEN}`)), TOKEN);
  assertEquals(bearerToken(req(`Bearer ${TOKEN} extra`)), null);
  assertEquals(bearerToken(req("Bearer")), null);
  assertEquals(bearerToken(req()), null);
  assertFalse(bearerToken(req(`Token ${TOKEN}`)) === TOKEN);
});

Deno.test("the gate: rate limit first, then the subscription; a failed read is no reason to tell the user to renew", async () => {
  const gate = (rate: boolean, entitled: () => Promise<boolean>) => toolGate<Ctx>({ allowRate: () => Promise.resolve(rate), entitled });
  await gate(true, () => Promise.resolve(true))(null, { userId: "u" });
  await assertRejects(() => gate(false, () => Promise.resolve(true))(null, { userId: "u" }), ToolError, RATE_LIMITED);
  await assertRejects(() => gate(true, () => Promise.resolve(false))(null, { userId: "u" }), ToolError, NOT_SUBSCRIBED);
  const e = await assertRejects(() => gate(true, () => Promise.reject(new Error("users: connection reset")))(null, { userId: "u" }));
  assertFalse(e instanceof ToolError, "an unexpected failure, not the subscription message");
});
