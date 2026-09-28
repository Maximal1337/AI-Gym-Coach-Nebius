import * as Sentry from "npm:@sentry/deno@^10";
import { admin, allowRate, subscriptionAccess, withSentry } from "../_shared/mod.ts";
import { allowedOrigins, isFlagEnabled, RATE_LIMITS, userForToolToken } from "../_shared/assistant.ts";
import { type McpServer, ToolError } from "../_shared/mcp.ts";
import { handleToolsRequest } from "./handler.ts";
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
  beforeCall: async (_tool, ctx) => {
    const { bucket, limit, windowSec } = RATE_LIMITS.notchTools;
    if (!(await allowRate(ctx.db, ctx.userId, bucket, limit, windowSec))) {
      throw new ToolError("Too many tool calls in the last minute. Wait a moment before trying again.");
    }
    if (!(await subscriptionAccess(ctx.db, ctx.userId)).ok) {
      throw new ToolError(
        "The user's Notch subscription isn't active, so their training data can't be used. Tell them they can renew in the app.",
      );
    }
  },
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
