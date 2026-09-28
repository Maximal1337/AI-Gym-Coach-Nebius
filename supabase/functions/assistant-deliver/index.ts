import { admin, sendPushForTurn, withSentry } from "../_shared/mod.ts";
import { recordSpend, spendBucketFor } from "../_shared/assistant.ts";
import { relaySecrets, verifyRelayRequest } from "../_shared/relay-auth.ts";
import { handleDeliver } from "./handler.ts";

/**
 * assistant-deliver (NH-53): see handler.ts. Called by the relay with a signed
 * request, not a Supabase JWT — verify_jwt is off for it in supabase/config.toml.
 */
Deno.serve(withSentry((req) => {
  const db = admin();
  return handleDeliver(req, {
    verify: (r, body) => verifyRelayRequest(r.headers, body, relaySecrets(), Math.floor(Date.now() / 1000)),
    complete: async (env, jobId, leaseToken, doc, skip) => {
      const { data, error } = await db.rpc("assistant_complete_job", {
        p_environment: env,
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_doc: doc,
        p_skip: skip,
      });
      if (error) {
        if (error.code === "P0001") return { refusal: error.message };
        throw new Error(`assistant_complete_job: ${error.message}`);
      }
      return { data: data as Record<string, unknown> };
    },
    recordSpend: (env, model, usage) => recordSpend(db, spendBucketFor(env), model, usage),
    // Best effort and never throws (mod.ts): a failed push must not fail the delivery.
    push: (userId, title, body, data) => sendPushForTurn(db, userId, title, body, data),
  });
}));
