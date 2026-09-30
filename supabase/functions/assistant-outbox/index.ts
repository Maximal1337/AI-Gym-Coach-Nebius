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
    defer: async (env, jobId, leaseToken, seconds, reason) => {
      const { data, error } = await db.rpc("assistant_defer_job", {
        p_environment: env,
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_seconds: seconds,
        p_reason: reason,
      });
      if (error) throw new Error(`assistant_defer_job: ${error.message}`);
      return data === true;
    },
    recordAgent: async (env, userId, sandboxName, tokenHash) => {
      const { data, error } = await db.rpc("assistant_agent_record", {
        p_environment: env,
        p_user_id: userId,
        p_sandbox_name: sandboxName,
        p_token_hash: tokenHash,
      });
      if (error) throw new Error(`assistant_agent_record: ${error.message}`);
      return data as string;
    },
    listAgents: async (env) => {
      const { data, error } = await db.rpc("assistant_agents_list", { p_environment: env });
      if (error) throw new Error(`assistant_agents_list: ${error.message}`);
      return (data ?? []) as Array<{ user_id: string; sandbox_name: string }>;
    },
  });
}));
