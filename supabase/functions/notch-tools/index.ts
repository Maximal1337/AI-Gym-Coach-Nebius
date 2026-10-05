import * as Sentry from "npm:@sentry/deno@^10";
import { admin, allowRate, subscriptionAccess, withSentry } from "../_shared/mod.ts";
import { allowedOrigins, isFlagEnabled, RATE_LIMITS, userForToolToken } from "../_shared/assistant.ts";
import type { McpServer } from "../_shared/mcp.ts";
import { handleToolsRequest, toolGate } from "./handler.ts";
import { SERVER_INSTRUCTIONS, type ToolContext, TOOLS } from "./tools.ts";

/**
 * notch-tools (NH-42): the MCP tool server each user's Hermes agent calls
 * over Streamable HTTP. It is called by a sandbox with the user's tool token,
 * not by the app with a Supabase JWT, so verify_jwt is off for it
 * (supabase/config.toml; deploy with --no-verify-jwt) and handler.ts does its
 * own authentication.
 */
const server: McpServer<ToolContext> = {
  name: "notch-tools",
  version: "0.1.0",
  instructions: SERVER_INSTRUCTIONS,
  tools: TOOLS,
  beforeCall: toolGate<ToolContext>({
    allowRate: (ctx) => {
      const { bucket, limit, windowSec } = RATE_LIMITS.notchTools;
      return allowRate(ctx.db, ctx.userId, bucket, limit, windowSec);
    },
    entitled: async (ctx) => (await subscriptionAccess(ctx.db, ctx.userId, { throwOnError: true })).ok,
  }),
  onError: (error, where) => {
    console.error("notch-tools failure", { ...where, error: error instanceof Error ? error.message : String(error) });
    Sentry.captureException(error, { tags: { function: "notch-tools", ...where } });
  },
};

Deno.serve(withSentry((req) => {
  const db = admin();
  return handleToolsRequest(req, {
    server,
    resolveUser: (token) => userForToolToken(db, token),
    isEnabled: (userId) => isFlagEnabled(db, userId, "assistant_chat"),
    context: (userId) => ({ db, userId, now: () => new Date() }),
    allowedOrigins: allowedOrigins(),
  });
}));
