import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Shared plumbing for the hackathon's new Edge Functions (assistant-*,
 * notch-tools, memory-*). Kept separate from mod.ts on purpose: building the
 * new features must never change how the live coaching functions behave
 * (D-17 in docs/nebius-hackathon-plan.md). Generic helpers that already work
 * (getUser, admin, allowRate, subscriptionAccess, withSentry) are still
 * imported from mod.ts.
 */

// ---------------------------------------------------------------- flags

/** Flags defined in public.feature_flags (migration 20260918130000). */
export type FeatureFlag = "assistant_chat" | "assistant_memory" | "assistant_workout";

/**
 * Whether a flag is on for this user — its global switch AND the user's own
 * row (see the migration for the kill-switch semantics). Fails closed: any
 * error reads as "off", so a broken check hides a feature instead of
 * exposing it to real users.
 */
export async function isFlagEnabled(db: SupabaseClient, userId: string, flag: FeatureFlag): Promise<boolean> {
  const { data, error } = await db.rpc("feature_enabled", { p_user_id: userId, p_flag: flag });
  if (error) {
    console.error("feature_enabled failed", { userId, flag, error: error.message });
    return false;
  }
  return data === true;
}

// ---------------------------------------------------------- tool tokens

/**
 * A user's sandbox authenticates to notch-tools with its own bearer token,
 * injected by the OpenShell gateway so the agent never sees it (D-28). The
 * database stores only the SHA-256 digest (assistant_agents.tool_token_hash,
 * migration 20260928120000), and a token resolves to a user id — nothing
 * else. Tokens are minted by the sandbox manager (NH-55) as 32 random bytes,
 * base64url-encoded.
 */
const TOOL_TOKEN_RE = /^[A-Za-z0-9_-]{32,200}$/;

export function isWellFormedToolToken(token: string): boolean {
  return TOOL_TOKEN_RE.test(token);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The user a tool token belongs to, or null (malformed, unknown, or lookup failed). */
export async function userForToolToken(db: Pick<SupabaseClient, "rpc">, token: string): Promise<string | null> {
  if (!isWellFormedToolToken(token)) return null;
  const { data, error } = await db.rpc("assistant_user_for_tool_token", { p_token_hash: await sha256Hex(token) });
  if (error) {
    console.error("assistant_user_for_tool_token failed", { error: error.message });
    return null;
  }
  return typeof data === "string" ? data : null;
}

// --------------------------------------------------------------- limits

/** Per-user fixed-window rate limits for the new endpoints, applied with mod.ts's allowRate(). */
export const RATE_LIMITS = {
  assistantSend: { bucket: "assistant-send", limit: 10, windowSec: 60 },
  notchTools: { bucket: "notch-tools", limit: 60, windowSec: 60 },
} as const;

/** Reads a secret; injectable so the pure helpers below can be tested without env access. */
export type EnvGetter = (name: string) => string | undefined;
const denoEnv: EnvGetter = (name) => Deno.env.get(name);

function envNumber(name: string, fallback: number, get: EnvGetter): number {
  const raw = get(name);
  const value = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Daily message caps — per account, since demo and judge accounts are used
 * by people outside the team, and across everyone. Read from secrets at call
 * time; a missing or malformed value falls back to the default. Spend is
 * capped separately, by spendCeilingsCents().
 */
export function dailyCaps(get: EnvGetter = denoEnv) {
  return {
    messagesPerUser: envNumber("ASSISTANT_DAILY_MESSAGES_PER_USER", 100, get),
    messagesGlobal: envNumber("ASSISTANT_DAILY_MESSAGES_GLOBAL", 1000, get),
  };
}

// ---------------------------------------------------------------- spend

/**
 * Hard Token Factory ceilings (D-34, NH-38): the worst case is bounded by
 * construction, so the credits can't run out and nobody pays out of pocket.
 *
 * Buckets follow the credit split (D-24): the agent's `prod` and `dev` keys on
 * member A's account, the nightly `memory` job on member B's. Spend is summed
 * per UTC day in public.assistant_spend (migration 20260928130000); the memory
 * job runs once a day, so its daily ceiling is its per-run ceiling.
 *
 * Where it's enforced:
 *  - assistant-send refuses a new message with LIMIT_REACHED_ERROR once the
 *    user's environment is at its ceiling — nothing reaches Token Factory;
 *  - assistant-outbox hands the relay no work for an environment at its
 *    ceiling, which also covers check-ins and messages queued earlier;
 *  - assistant-deliver records the spend the relay reports for each turn;
 *  - the memory job checks before each user and records after each call.
 * A turn already running when the ceiling is hit still finishes, so a day can
 * overshoot by at most the turns in flight — at most one per user.
 */
export type SpendBucket = "prod" | "dev" | "memory";

/** Error code assistant-send returns at the ceiling; the app shows its own localized message. */
export const LIMIT_REACHED_ERROR = "daily_limit_reached";

export function spendBucketFor(environment: "dev" | "prod"): SpendBucket {
  return environment;
}

/** Daily ceilings in cents per bucket, from secrets; 0 turns a bucket off entirely. */
export function spendCeilingsCents(get: EnvGetter = denoEnv): Record<SpendBucket, number> {
  return {
    prod: envNumber("ASSISTANT_SPEND_CEILING_CENTS_PROD", 100, get),
    dev: envNumber("ASSISTANT_SPEND_CEILING_CENTS_DEV", 50, get),
    memory: envNumber("ASSISTANT_SPEND_CEILING_CENTS_MEMORY", 50, get),
  };
}

/** Token Factory list prices, in cents per 1M tokens (§7 of the plan). */
export const TOKEN_FACTORY_PRICES = {
  super: { input: 30, output: 90 },
  ultra: { input: 100, output: 300 },
  lightning: { input: 6, output: 24 },
} as const;

/**
 * Price for a Token Factory model id. A model we don't recognize is priced
 * as the most expensive one we know, so a new or renamed model can only make
 * the ceiling trip earlier, never later.
 */
export function priceFor(model: string): { input: number; output: number } {
  const id = model.toLowerCase();
  if (id.includes("lightning")) return TOKEN_FACTORY_PRICES.lightning;
  if (id.includes("super")) return TOKEN_FACTORY_PRICES.super;
  return TOKEN_FACTORY_PRICES.ultra;
}

export interface TokenUsage {
  tokensInput: number;
  tokensOutput: number;
}

/**
 * Charged for a turn whose usage wasn't reported (a relay or harness that
 * omits it), so missing data can't switch the ceiling off. Generous on
 * purpose: a long agent turn with tool calls.
 */
export const FALLBACK_TURN_USAGE: TokenUsage = { tokensInput: 30_000, tokensOutput: 3_000 };

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** Normalizes reported usage: anything malformed is replaced by FALLBACK_TURN_USAGE. */
export function usageOrFallback(usage: Partial<TokenUsage> | null | undefined): TokenUsage {
  if (usage && isCount(usage.tokensInput) && isCount(usage.tokensOutput)) {
    return { tokensInput: usage.tokensInput, tokensOutput: usage.tokensOutput };
  }
  return FALLBACK_TURN_USAGE;
}

export function costCents(model: string, usage: TokenUsage): number {
  const price = priceFor(model);
  return (usage.tokensInput * price.input + usage.tokensOutput * price.output) / 1_000_000;
}

/**
 * Whether a bucket is still under today's ceiling. Fails closed: if the total
 * can't be read, nothing is sent to Token Factory.
 */
export async function checkSpend(
  db: Pick<SupabaseClient, "rpc">,
  bucket: SpendBucket,
  ceilings: Record<SpendBucket, number> = spendCeilingsCents(),
): Promise<{ allowed: boolean; spentCents: number; ceilingCents: number }> {
  const ceilingCents = ceilings[bucket];
  const { data, error } = await db.rpc("assistant_spend_today", { p_bucket: bucket });
  const spentCents = Number(data ?? 0);
  if (error || !Number.isFinite(spentCents)) {
    console.error("assistant_spend_today failed", { bucket, error: error?.message });
    return { allowed: false, spentCents: Number.NaN, ceilingCents };
  }
  return { allowed: spentCents < ceilingCents, spentCents, ceilingCents };
}

/**
 * Records one model call's spend and returns today's new total in cents, or
 * null if the write failed (logged — a silent failure would be a budget leak).
 */
export async function recordSpend(
  db: Pick<SupabaseClient, "rpc">,
  bucket: SpendBucket,
  model: string,
  reported: Partial<TokenUsage> | null | undefined,
): Promise<number | null> {
  const usage = usageOrFallback(reported);
  const { data, error } = await db.rpc("assistant_record_spend", {
    p_bucket: bucket,
    p_tokens_input: usage.tokensInput,
    p_tokens_output: usage.tokensOutput,
    p_cost_cents: costCents(model, usage),
  });
  if (error) {
    console.error("assistant_record_spend failed", { bucket, model, error: error.message });
    return null;
  }
  return Number(data);
}

// ------------------------------------------------------------ languages

/** Reply languages the app supports — mirrors AppLanguage in apps/mobile/src/lib/language.tsx. */
export const SUPPORTED_LANGUAGES = ["en", "he", "ar", "es", "de", "pt", "fr", "it"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

// ----------------------------------------------------------------- CORS

/**
 * CORS headers for the new endpoints. Unlike mod.ts's corsHeaders there is
 * no "*": the mobile app is a native client and sends no Origin, so no
 * browser origin is allowed unless listed in ASSISTANT_ALLOWED_ORIGINS
 * (comma-separated).
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Vary": "Origin",
  };
  const origin = req.headers.get("origin");
  if (origin && allowedOrigins().includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** Browser origins allowed to call the new endpoints (ASSISTANT_ALLOWED_ORIGINS, comma-separated). */
export function allowedOrigins(get: EnvGetter = denoEnv): string[] {
  return (get("ASSISTANT_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** JSON response with corsHeadersFor() — the new functions' counterpart to mod.ts's json(). */
export function respond(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeadersFor(req) },
  });
}
