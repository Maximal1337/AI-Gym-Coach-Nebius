import { admin, allowRate, getUser, subscriptionAccess, withSentry } from "../_shared/mod.ts";
import { checkSpend, corsHeadersFor, dailyCaps, isFlagEnabled, RATE_LIMITS, spendBucketFor } from "../_shared/assistant.ts";
import { handleSend } from "./handler.ts";

/** assistant-send (NH-51): see handler.ts for the checks and responses. */
Deno.serve(withSentry((req) => {
  const db = admin();
  return handleSend(req, {
    corsHeaders: corsHeadersFor,
    getUser,
    isEnabled: (userId) => isFlagEnabled(db, userId, "assistant_chat"),
    entitlement: (userId) => subscriptionAccess(db, userId),
    allowRate: (userId) => {
      const { bucket, limit, windowSec } = RATE_LIMITS.assistantSend;
      return allowRate(db, userId, bucket, limit, windowSec);
    },
    environmentFor: async (userId) => {
      const { data, error } = await db.rpc("assistant_environment", { p_user_id: userId });
      if (error) throw new Error(`assistant_environment: ${error.message}`);
      return data === "dev" ? "dev" : "prod";
    },
    spendAllowed: async (environment) => (await checkSpend(db, spendBucketFor(environment))).allowed,
    caps: () => dailyCaps(),
    enqueue: async (userId, text, clientMessageId, userCap, globalCap) => {
      const { data, error } = await db.rpc("assistant_enqueue_message", {
        p_user_id: userId,
        p_text: text,
        p_client_message_id: clientMessageId,
        p_user_cap: userCap,
        p_global_cap: globalCap,
      });
      if (error) {
        if (error.code === "P0001") return { refusal: error.message };
        throw new Error(`assistant_enqueue_message: ${error.message}`);
      }
      return { data: data as Record<string, unknown> };
    },
  });
}));
