import type { TokenUsage } from "../_shared/assistant.ts";
import {
  buildMemoryWrite,
  ExtractionError,
  type MemoryWrite,
  parseOperations,
  type SourceMessage,
  systemPrompt,
  userPrompt,
} from "../_shared/memory-extraction.ts";
import { type FactDoc, isValidFactDoc, type StoredFact } from "../_shared/memory-scoring.ts";

/**
 * memory-nightly (NH-63): one call of the nightly memory job. Supabase Cron
 * calls it every 10 minutes between 00:00 and 02:59 UTC; each call works
 * through the users due today (assistant_memory_due) until its time budget is
 * spent, and the next call picks up the rest.
 *
 * Per user: read the facts and the oldest unread messages; if the user wrote
 * something, ask the model for operations (NH-61), otherwise just refresh
 * scores and expiry; apply the result in one transaction. A failure is
 * recorded as that user's run for today — no retry storm, no repeated spend —
 * and their watermark stays put, so tomorrow reads the same messages.
 * Spend goes to the memory bucket on member B's key (D-24) and stops the run
 * at the D-34 ceiling.
 */

export interface MemorySources {
  watermark: string | null;
  new_watermark: string | null;
  language: string;
  facts: Array<{ id: string; doc: FactDoc; pinned: boolean }>;
  messages: SourceMessage[];
}

export interface MemoryDeps {
  authorized: (req: Request) => boolean;
  due: (limit: number) => Promise<string[]>;
  sources: (userId: string) => Promise<MemorySources>;
  spendAllowed: () => Promise<boolean>;
  /**
   * One model call. `retriedSpent`, on the result or a failure, counts retried
   * attempts that may have run the model; a failure may also carry `spent`
   * and `usage` for its own attempt.
   */
  extract: (system: string, user: string) => Promise<{ content: string; usage?: TokenUsage; retriedSpent?: number }>;
  recordSpend: (usage: TokenUsage | undefined) => Promise<unknown>;
  apply: (userId: string, write: MemoryWrite, watermark: string | null) => Promise<unknown>;
  markFailed: (userId: string, error: string) => Promise<void>;
  now: () => Date;
  elapsedMs: () => number;
  /** Stop starting new users after this much time, to finish well inside the function's limit. */
  budgetMs: number;
  batch: number;
  log: (event: string, fields: Record<string, unknown>) => void;
}

export type UserOutcome = "updated" | "refreshed" | "failed";

export interface RunSummary {
  processed: number;
  updated: number;
  refreshed: number;
  failed: number;
  facts_added: number;
  facts_removed: number;
  dropped_operations: number;
  stopped: null | "time_budget" | "spend_ceiling";
  duration_ms: number;
}

export async function processUser(userId: string, deps: MemoryDeps, summary: RunSummary): Promise<UserOutcome> {
  const src = await deps.sources(userId);
  const now = deps.now();
  // A stored fact the scoring module can't read is left alone rather than guessed at.
  const stored: StoredFact[] = src.facts.filter((f) => isValidFactDoc(f.doc));
  const wrote = src.messages.some((m) => m.role === "user");

  // Retried attempts the client counted as possibly spent, at the fallback charge.
  const chargeRetries = async (n: number | undefined) => {
    for (let i = 0; i < (n ?? 0); i++) await deps.recordSpend(undefined);
  };

  let write: MemoryWrite;
  if (!wrote) {
    write = buildMemoryWrite(stored, [], [], now);
  } else {
    let reply: { content: string; usage?: TokenUsage; retriedSpent?: number };
    try {
      reply = await deps.extract(systemPrompt(src.language), userPrompt({ facts: stored, messages: src.messages, language: src.language }));
    } catch (e) {
      const err = e as { spent?: boolean; usage?: TokenUsage; retriedSpent?: number };
      await chargeRetries(err.retriedSpent);
      if (err.spent !== false) await deps.recordSpend(err.usage);
      await deps.markFailed(userId, `model: ${String(e)}`);
      return "failed";
    }
    await chargeRetries(reply.retriedSpent);
    await deps.recordSpend(reply.usage);
    try {
      const { operations, dropped } = parseOperations(reply.content, stored.length, src.messages.length);
      summary.dropped_operations += dropped;
      write = buildMemoryWrite(stored, operations, src.messages, now);
    } catch (e) {
      if (!(e instanceof ExtractionError)) throw e;
      await deps.markFailed(userId, `extraction: ${e.message}`);
      return "failed";
    }
  }

  try {
    await deps.apply(userId, write, src.new_watermark);
  } catch (e) {
    await deps.markFailed(userId, `apply: ${String(e)}`);
    return "failed";
  }
  summary.facts_added += write.insert.length;
  summary.facts_removed += write.remove.length;
  return wrote ? "updated" : "refreshed";
}

export async function handleMemoryRun(req: Request, deps: MemoryDeps): Promise<Response> {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!deps.authorized(req)) return reply(401, { error: "unauthorized" });

  const summary: RunSummary = {
    processed: 0,
    updated: 0,
    refreshed: 0,
    failed: 0,
    facts_added: 0,
    facts_removed: 0,
    dropped_operations: 0,
    stopped: null,
    duration_ms: 0,
  };
  for (const userId of await deps.due(deps.batch)) {
    if (deps.elapsedMs() >= deps.budgetMs) {
      summary.stopped = "time_budget";
      break;
    }
    if (!(await deps.spendAllowed())) {
      summary.stopped = "spend_ceiling";
      break;
    }
    let outcome: UserOutcome;
    try {
      outcome = await processUser(userId, deps, summary);
    } catch (e) {
      deps.log("memory_user_error", { user: userId, error: String(e) });
      await deps.markFailed(userId, `unexpected: ${String(e)}`).catch(() => {});
      outcome = "failed";
    }
    summary.processed++;
    summary[outcome]++;
  }
  summary.duration_ms = deps.elapsedMs();
  // The run summary, and the measured duration that keeps "outgrew the Edge Function limit" a checkable trigger (D-23).
  deps.log("memory_run", { ...summary });
  return reply(200, { summary });
}
