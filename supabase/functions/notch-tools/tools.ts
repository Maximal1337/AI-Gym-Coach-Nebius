import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ToolDefinition } from "../_shared/mcp.ts";
import { READ_TOOLS } from "./read-tools.ts";

/**
 * The tools a user's Hermes agent can call (NH-42…NH-44). Each handler gets
 * the admin client and the user id resolved from the sandbox's tool token —
 * never a user id from the arguments. The admin client bypasses RLS, so every
 * query MUST filter by ctx.userId (the SECURITY MODEL note in mod.ts).
 */
export interface ToolContext {
  db: SupabaseClient;
  userId: string;
  now: () => Date;
}

export const SERVER_INSTRUCTIONS =
  "Notch's tools over the user's own training data. Read before you answer questions about their plan or history; " +
  "never guess numbers. Every change you make is recorded and can be undone.";

const ping: ToolDefinition<ToolContext> = {
  name: "notch_ping",
  title: "Check the connection",
  description: "Checks that Notch's tools are reachable and returns the server time. Only for connection tests.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  readOnly: true,
  handler: (_args, ctx) => Promise.resolve({ ok: true, server_time: ctx.now().toISOString() }),
};

export const TOOLS: readonly ToolDefinition<ToolContext>[] = [ping, ...READ_TOOLS];
