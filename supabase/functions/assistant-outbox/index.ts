import { admin, withSentry } from "../_shared/mod.ts";
import { checkSpend, recordSpend, spendBucketFor } from "../_shared/assistant.ts";
import { relaySecrets, verifyRelayRequest } from "../_shared/relay-auth.ts";
import { handleOutbox } from "./handler.ts";

/**
 * assistant-outbox (NH-52): see handler.ts. Called by the relay with a signed
 * request, not a Supabase JWT — verify_jwt is off for it in supabase/config.toml.
 */
Deno.serve(withSentry((req) => {
  const db = admin();
  return handleOutbox(req, {
    verify: (r, body) => verifyRelayRequest(r.headers, body, relaySecrets(), Math.floor(Date.now() / 1000)),
    spendAllowed: async (env) => (await checkSpend(db, spendBucketFor(env))).allowed,
    claim: async (env, limit, leaseSeconds) => {
      const { data, error } = await db.rpc("assistant_claim_jobs", {
        p_environment: env,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`assistant_claim_jobs: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    },
    context: async (jobId) => {
      const { data, error } = await db.rpc("assistant_job_context", { p_job_id: jobId });
      if (error) throw new Error(`assistant_job_context: ${error.message}`);
      return data as Record<string, unknown>;
    },
    fail: async (jobId, leaseToken, message) => {
      const { data, error } = await db.rpc("assistant_ack_job", {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_ok: false,
        p_error: message,
      });
      if (error) throw new Error(`assistant_ack_job: ${error.message}`);
      return data === true;
    },
    recordSpend: (env, model, usage) => recordSpend(db, spendBucketFor(env), model, usage),
  });
}));
