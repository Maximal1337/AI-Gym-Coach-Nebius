/**
 * A minimal, stateless MCP server core for Edge Functions (NH-42).
 *
 * Implements the parts of the Model Context Protocol's Streamable HTTP
 * transport that a tool server needs — `initialize`, `ping`, `tools/list`,
 * `tools/call` — over plain JSON-RPC 2.0. Every POST gets a single JSON
 * response (the transport allows that instead of an SSE stream), and no
 * session is kept between requests, which suits short-lived Edge Function
 * isolates. The official SDK's HTTP transport targets Node's http module;
 * this module is transport-agnostic and has no dependencies, so it can be
 * tested without a server.
 *
 * Error model, per the MCP spec:
 *  - protocol problems (bad JSON-RPC, unknown method, unknown tool) are
 *    JSON-RPC errors;
 *  - problems the model can fix or should report to the user (invalid
 *    arguments, a refused or failed tool) are tool results with
 *    `isError: true`, so the agent sees them and can react.
 * Only ToolError messages reach the agent verbatim. Any other exception is
 * reported as a generic failure — no stack traces, no internals, no secrets.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** The subset of JSON Schema the tools use; validate() understands exactly this. */
export interface JsonSchema {
  type: "object" | "string" | "integer" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: false;
  enum?: readonly (string | number)[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: "uuid";
  items?: JsonSchema;
  maxItems?: number;
}

/** A failure whose message is safe to show the agent (and, through it, the user). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolDefinition<Ctx> {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  /** true for tools that only read; surfaced as MCP tool annotations. */
  readOnly: boolean;
  handler: (args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;
}

export interface McpServer<Ctx> {
  name: string;
  version: string;
  instructions?: string;
  tools: readonly ToolDefinition<Ctx>[];
  /** Runs before every tool call (rate limits, entitlement); throw ToolError to refuse. */
  beforeCall?: (tool: ToolDefinition<Ctx>, ctx: Ctx) => Promise<void>;
  /** Called with unexpected (non-ToolError) failures, for logging. */
  onError?: (error: unknown, context: { method: string; tool?: string }) => void;
}

type JsonRpcId = string | number;
interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string };
}
interface JsonRpcResult {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}
export type JsonRpcResponse = JsonRpcError | JsonRpcResult;

export const JSONRPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export const GENERIC_TOOL_FAILURE = "The tool failed unexpectedly. Tell the user it didn't work and don't retry.";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a value against the JsonSchema subset; returns an error message or null. */
export function validate(schema: JsonSchema, value: unknown, path = "arguments"): string | null {
  switch (schema.type) {
    case "object": {
      if (!isPlainObject(value)) return `${path} must be an object`;
      for (const key of schema.required ?? []) {
        if (!(key in value) || value[key] === undefined) return `${path}.${key} is required`;
      }
      for (const [key, v] of Object.entries(value)) {
        const sub = schema.properties?.[key];
        if (!sub) {
          if (schema.additionalProperties === false) return `${path}.${key} is not allowed`;
          continue;
        }
        const err = validate(sub, v, `${path}.${key}`);
        if (err) return err;
      }
      return null;
    }
    case "string": {
      if (typeof value !== "string") return `${path} must be a string`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} must be at least ${schema.minLength} characters`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} must be at most ${schema.maxLength} characters`;
      if (schema.format === "uuid" && !UUID_RE.test(value)) return `${path} must be a UUID`;
      break;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`;
      if (schema.type === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
      break;
    }
    case "boolean":
      if (typeof value !== "boolean") return `${path} must be a boolean`;
      break;
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} must have at most ${schema.maxItems} items`;
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const err = validate(schema.items, value[i], `${path}[${i}]`);
          if (err) return err;
        }
      }
      return null;
    }
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    return `${path} must be one of: ${schema.enum.join(", ")}`;
  }
  return null;
}

function error(id: JsonRpcId | null, code: number, message: string): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolText(text: string, isError: boolean) {
  return { content: [{ type: "text", text }], isError };
}

async function callTool<Ctx>(server: McpServer<Ctx>, params: unknown, ctx: Ctx, id: JsonRpcId): Promise<JsonRpcResponse> {
  if (!isPlainObject(params) || typeof params.name !== "string") {
    return error(id, JSONRPC.invalidParams, "tools/call needs params.name");
  }
  const tool = server.tools.find((t) => t.name === params.name);
  if (!tool) return error(id, JSONRPC.invalidParams, `Unknown tool: ${params.name}`);

  const args = params.arguments ?? {};
  const invalid = validate(tool.inputSchema, args);
  if (invalid) return { jsonrpc: "2.0", id, result: toolText(`Invalid arguments: ${invalid}`, true) };

  try {
    await server.beforeCall?.(tool, ctx);
    const value = await tool.handler(args as Record<string, unknown>, ctx);
    const result: Record<string, unknown> = toolText(JSON.stringify(value ?? null), false);
    if (isPlainObject(value)) result.structuredContent = value;
    return { jsonrpc: "2.0", id, result };
  } catch (e) {
    if (e instanceof ToolError) return { jsonrpc: "2.0", id, result: toolText(e.message, true) };
    server.onError?.(e, { method: "tools/call", tool: tool.name });
    return { jsonrpc: "2.0", id, result: toolText(GENERIC_TOOL_FAILURE, true) };
  }
}

async function handleOne<Ctx>(server: McpServer<Ctx>, msg: unknown, ctx: Ctx): Promise<JsonRpcResponse | null> {
  if (!isPlainObject(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    const id = isPlainObject(msg) && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null;
    return error(id, JSONRPC.invalidRequest, "Invalid JSON-RPC request");
  }
  const hasId = "id" in msg && msg.id !== undefined;
  // Responses and notifications (no id) need no reply — this server never
  // sends requests to the client, so any response is simply dropped.
  if (!hasId) return null;
  if (typeof msg.id !== "string" && typeof msg.id !== "number") {
    return error(null, JSONRPC.invalidRequest, "Invalid JSON-RPC id");
  }
  const id = msg.id;

  try {
    switch (msg.method) {
      case "initialize": {
        const requested = isPlainObject(msg.params) ? msg.params.protocolVersion : undefined;
        const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly unknown[]).includes(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: server.name, version: server.version },
            ...(server.instructions ? { instructions: server.instructions } : {}),
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: server.tools.map((t) => ({
              name: t.name,
              ...(t.title ? { title: t.title } : {}),
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: {
                readOnlyHint: t.readOnly,
                destructiveHint: false,
                openWorldHint: false,
              },
            })),
          },
        };
      case "tools/call":
        return await callTool(server, msg.params, ctx, id);
      default:
        return error(id, JSONRPC.methodNotFound, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    server.onError?.(e, { method: msg.method });
    return error(id, JSONRPC.internalError, "Internal error");
  }
}

/**
 * Handles a parsed POST body: one JSON-RPC message, or a batch (accepted for
 * clients on the 2025-03-26 revision). Returns what to send back, or null when
 * the body held only notifications (the transport then answers 202 Accepted).
 */
export async function handleMcp<Ctx>(
  server: McpServer<Ctx>,
  body: unknown,
  ctx: Ctx,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return error(null, JSONRPC.invalidRequest, "Empty batch");
    const replies: JsonRpcResponse[] = [];
    for (const msg of body) {
      const reply = await handleOne(server, msg, ctx);
      if (reply) replies.push(reply);
    }
    return replies.length ? replies : null;
  }
  return handleOne(server, body, ctx);
}
