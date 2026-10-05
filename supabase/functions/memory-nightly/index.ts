import { admin, withSentry } from "../_shared/mod.ts";
import { checkSpend, recordSpend } from "../_shared/assistant.ts";
import { OPERATIONS_SCHEMA } from "../_shared/memory-extraction.ts";
import { tokenFactoryChat } from "../_shared/token-factory.ts";
import { handleMemoryRun, type MemorySources } from "./handler.ts";

/**
 * memory-nightly (NH-63): see handler.ts. Called by Supabase Cron with the
 * x-cron-secret header (supabase/cron/assistant.sql), not a user JWT, so
 * verify_jwt is off for it in supabase/config.toml.
 *
 * Secrets: MEMORY_CRON_SECRET (≥ 32 characters), MEMORY_TOKEN_FACTORY_API_KEY
 * (member B's key, D-24), MEMORY_MODEL (the Nemotron model id on Token Factory).
 */

// An Edge Function gets 150 s of wall-clock time on Supabase's free plan (400 s
// on paid plans); the job assumes the lower. A user is started only while
// their model call, at its full timeout, still ends inside it with room for
// the writes, and the call stops retrying at the same deadline. A function cut
// off mid-user would record no spend and no run, and the next call would pay
// for that user again.
const WALL_CLOCK_MS = 150_000;
const MODEL_TIMEOUT_MS = 60_000;
const MARGIN_MS = 15_000;

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(withSentry((req) => {
  const started = Date.now();
  const cronSecret = Deno.env.get("MEMORY_CRON_SECRET") ?? "";
  const apiKey = Deno.env.get("MEMORY_TOKEN_FACTORY_API_KEY") ?? "";
  const model = Deno.env.get("MEMORY_MODEL") ?? "";
  if (cronSecret.length < 32 || !apiKey || !model) {
    return Promise.resolve(new Response(JSON.stringify({ error: "not_configured" }), { status: 503 }));
  }
  const db = admin();
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  return handleMemoryRun(req, {
    authorized: (r) => sameSecret(r.headers.get("x-cron-secret") ?? "", cronSecret),
    due: async (limit) => ((await rpc("assistant_memory_due", { p_limit: limit })) ?? []) as string[],
    sources: async (userId) => (await rpc("assistant_memory_sources", { p_user_id: userId })) as MemorySources,
    spendAllowed: async () => (await checkSpend(db, "memory")).allowed,
    extract: async (system, user) =>
      await tokenFactoryChat({
        apiKey,
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        jsonSchema: { name: "memory_operations", schema: OPERATIONS_SCHEMA },
        // Thinking stays on for this job (D-03); the budget leaves room for it and the JSON.
        maxTokens: 8_000,
        timeoutMs: MODEL_TIMEOUT_MS,
        deadlineMs: started + WALL_CLOCK_MS - MARGIN_MS,
      }),
    recordSpend: (usage) => recordSpend(db, "memory", model, usage),
    apply: (userId, write, watermark) =>
      rpc("assistant_memory_apply", {
        p_user_id: userId,
        p_remove: write.remove.map((r) => r.id),
        p_updates: write.update,
        p_inserts: write.insert,
        p_watermark: watermark,
      }),
    markFailed: async (userId, error) => {
      await rpc("assistant_memory_mark_failed", { p_user_id: userId, p_error: error });
    },
    now: () => new Date(),
    elapsedMs: () => Date.now() - started,
    budgetMs: WALL_CLOCK_MS - MODEL_TIMEOUT_MS - MARGIN_MS,
    batch: 50,
    log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
  });
}));
