// Unit tests for the MCP server core (NH-42). Run: deno test --no-config supabase/functions/
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  GENERIC_TOOL_FAILURE,
  handleMcp,
  JSONRPC,
  type JsonSchema,
  LATEST_PROTOCOL_VERSION,
  type McpServer,
  type ToolDefinition,
  ToolError,
  validate,
} from "./mcp.ts";

interface Ctx {
  userId: string;
}
const ctx: Ctx = { userId: "u1" };

const echo: ToolDefinition<Ctx> = {
  name: "echo",
  description: "Echoes a message",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string", maxLength: 10 } },
    required: ["message"],
    additionalProperties: false,
  },
  readOnly: true,
  handler: (args, c) => Promise.resolve({ message: args.message, user: c.userId }),
};
const refuses: ToolDefinition<Ctx> = {
  name: "refuses",
  description: "Always refuses",
  inputSchema: { type: "object", properties: {} },
  readOnly: false,
  handler: () => Promise.reject(new ToolError("Not allowed: outside the write scope")),
};
const crashes: ToolDefinition<Ctx> = {
  name: "crashes",
  description: "Always crashes",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
  handler: () => Promise.reject(new Error("db password is hunter2 at line 42")),
};

function makeServer(overrides: Partial<McpServer<Ctx>> = {}) {
  const errors: Array<{ error: unknown; method: string; tool?: string }> = [];
  const server: McpServer<Ctx> = {
    name: "test",
    version: "1.0.0",
    instructions: "Use the tools.",
    tools: [echo, refuses, crashes],
    onError: (error, where) => errors.push({ error, ...where }),
    ...overrides,
  };
  return { server, errors };
}

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, params });

// deno-lint-ignore no-explicit-any
async function call(server: McpServer<Ctx>, body: unknown): Promise<any> {
  return await handleMcp(server, body, ctx);
}

// ------------------------------------------------------------ lifecycle

Deno.test("initialize: echoes a supported protocol version", async () => {
  const { server } = makeServer();
  const r = await call(server, rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hermes" } }));
  assertEquals(r.result.protocolVersion, "2025-03-26");
  assertEquals(r.result.serverInfo, { name: "test", version: "1.0.0" });
  assertEquals(r.result.capabilities, { tools: { listChanged: false } });
  assertEquals(r.result.instructions, "Use the tools.");
});

Deno.test("initialize: an unknown protocol version gets the latest supported one", async () => {
  const { server } = makeServer();
  const r = await call(server, rpc("initialize", { protocolVersion: "1999-01-01" }));
  assertEquals(r.result.protocolVersion, LATEST_PROTOCOL_VERSION);
});

Deno.test("notifications get no reply", async () => {
  const { server } = makeServer();
  assertEquals(await call(server, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assertEquals(await call(server, [{ jsonrpc: "2.0", method: "notifications/initialized" }]), null);
});

Deno.test("ping returns an empty result", async () => {
  const { server } = makeServer();
  assertEquals(await call(server, rpc("ping", undefined, "p")), { jsonrpc: "2.0", id: "p", result: {} });
});

Deno.test("tools/list: names, schemas and read-only annotations", async () => {
  const { server } = makeServer();
  const r = await call(server, rpc("tools/list"));
  assertEquals(r.result.tools.map((t: { name: string }) => t.name), ["echo", "refuses", "crashes"]);
  assertEquals(r.result.tools[0].inputSchema, echo.inputSchema);
  assertEquals(r.result.tools[0].annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  assertFalse(r.result.tools[1].annotations.readOnlyHint);
});

// ------------------------------------------------------------ tools/call

Deno.test("tools/call: returns text and structured content", async () => {
  const { server } = makeServer();
  const r = await call(server, rpc("tools/call", { name: "echo", arguments: { message: "hi" } }));
  assertFalse(r.result.isError);
  assertEquals(r.result.structuredContent, { message: "hi", user: "u1" });
  assertEquals(JSON.parse(r.result.content[0].text), { message: "hi", user: "u1" });
});

Deno.test("tools/call: invalid arguments come back as a tool error the model can fix", async () => {
  const { server } = makeServer();
  const missing = await call(server, rpc("tools/call", { name: "echo", arguments: {} }));
  assert(missing.result.isError);
  assertStringIncludes(missing.result.content[0].text, "arguments.message is required");
  const tooLong = await call(server, rpc("tools/call", { name: "echo", arguments: { message: "x".repeat(11) } }));
  assertStringIncludes(tooLong.result.content[0].text, "at most 10 characters");
  const extra = await call(server, rpc("tools/call", { name: "echo", arguments: { message: "hi", user_id: "someone-else" } }));
  assertStringIncludes(extra.result.content[0].text, "arguments.user_id is not allowed");
});

Deno.test("tools/call: missing arguments count as an empty object", async () => {
  const { server } = makeServer();
  const r = await call(server, rpc("tools/call", { name: "refuses" }));
  assert(r.result.isError);
  assertEquals(r.result.content[0].text, "Not allowed: outside the write scope");
});

Deno.test("tools/call: a ToolError message reaches the agent verbatim", async () => {
  const { server, errors } = makeServer();
  const r = await call(server, rpc("tools/call", { name: "refuses", arguments: {} }));
  assertEquals(r.result.content[0].text, "Not allowed: outside the write scope");
  assertEquals(errors.length, 0, "a refusal is not an unexpected error");
});

Deno.test("tools/call: an unexpected failure leaks nothing and is logged", async () => {
  const { server, errors } = makeServer();
  const r = await call(server, rpc("tools/call", { name: "crashes", arguments: {} }));
  assert(r.result.isError);
  assertEquals(r.result.content[0].text, GENERIC_TOOL_FAILURE);
  assertFalse(JSON.stringify(r).includes("hunter2"));
  assertEquals(errors.length, 1);
  assertEquals(errors[0].tool, "crashes");
});

Deno.test("tools/call: beforeCall can refuse a call before the handler runs", async () => {
  let ran = false;
  const { server } = makeServer({
    tools: [{ ...echo, handler: () => (ran = true, Promise.resolve({})) }],
    beforeCall: () => Promise.reject(new ToolError("Too many tool calls")),
  });
  const r = await call(server, rpc("tools/call", { name: "echo", arguments: { message: "hi" } }));
  assert(r.result.isError);
  assertEquals(r.result.content[0].text, "Too many tool calls");
  assertFalse(ran);
});

Deno.test("tools/call: an unknown tool is a protocol error", async () => {
  const { server } = makeServer();
  const r = await call(server, rpc("tools/call", { name: "drop_tables", arguments: {} }));
  assertEquals(r.error.code, JSONRPC.invalidParams);
});

Deno.test("tools/call: a non-object result is still returned as text", async () => {
  const { server } = makeServer({ tools: [{ ...echo, handler: () => Promise.resolve([1, 2]) }] });
  const r = await call(server, rpc("tools/call", { name: "echo", arguments: { message: "hi" } }));
  assertEquals(r.result.content[0].text, "[1,2]");
  assertFalse("structuredContent" in r.result);
});

// ------------------------------------------------------------ JSON-RPC errors

Deno.test("an unknown method is -32601", async () => {
  const { server } = makeServer();
  assertEquals((await call(server, rpc("resources/list"))).error.code, JSONRPC.methodNotFound);
});

Deno.test("malformed requests are -32600", async () => {
  const { server } = makeServer();
  assertEquals((await call(server, { id: 1, method: "ping" })).error.code, JSONRPC.invalidRequest);
  assertEquals((await call(server, "ping")).error.code, JSONRPC.invalidRequest);
  assertEquals((await call(server, { jsonrpc: "2.0", id: { a: 1 }, method: "ping" })).error.code, JSONRPC.invalidRequest);
  assertEquals((await call(server, [])).error.code, JSONRPC.invalidRequest);
});

Deno.test("a batch answers its requests and skips its notifications", async () => {
  const { server } = makeServer();
  const r = await call(server, [rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("ping", undefined, 2)]);
  assertEquals(r.map((x: { id: number }) => x.id), [1, 2]);
});

// ------------------------------------------------------------ validate

Deno.test("validate: types, bounds, enums and formats", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      sets: { type: "integer", minimum: 1, maximum: 20 },
      kind: { type: "string", enum: ["swap", "replace"] },
      tags: { type: "array", items: { type: "string", maxLength: 3 }, maxItems: 2 },
      flag: { type: "boolean" },
    },
    required: ["id"],
    additionalProperties: false,
  };
  const ok = { id: "3f1c2a5e-0b7d-4c1e-9a2b-1c2d3e4f5a6b", sets: 3, kind: "swap", tags: ["a"], flag: true };
  assertEquals(validate(schema, ok), null);
  assertEquals(validate(schema, { ...ok, id: "not-a-uuid" }), "arguments.id must be a UUID");
  assertEquals(validate(schema, { ...ok, sets: 2.5 }), "arguments.sets must be an integer");
  assertEquals(validate(schema, { ...ok, sets: 0 }), "arguments.sets must be at least 1");
  assertEquals(validate(schema, { ...ok, sets: "3" }), "arguments.sets must be a number");
  assertEquals(validate(schema, { ...ok, kind: "delete" }), "arguments.kind must be one of: swap, replace");
  assertEquals(validate(schema, { ...ok, tags: ["a", "b", "c"] }), "arguments.tags must have at most 2 items");
  assertEquals(validate(schema, { ...ok, tags: ["long"] }), "arguments.tags[0] must be at most 3 characters");
  assertEquals(validate(schema, { ...ok, flag: "yes" }), "arguments.flag must be a boolean");
  assertEquals(validate(schema, [ok]), "arguments must be an object");
  assertEquals(validate(schema, null), "arguments must be an object");
  assertEquals(validate(schema, { sets: 3 }), "arguments.id is required");
});
