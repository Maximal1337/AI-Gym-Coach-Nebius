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

// --------------------------------------------------------------- limits

/** Per-user fixed-window rate limits for the new endpoints, applied with mod.ts's allowRate(). */
export const RATE_LIMITS = {
  assistantSend: { bucket: "assistant-send", limit: 10, windowSec: 60 },
  notchTools: { bucket: "notch-tools", limit: 60, windowSec: 60 },
} as const;

function envNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  const value = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Daily caps that protect the hackathon credits (§7 of the plan) — per
 * account, since demo and judge accounts are used by people outside the
 * team, and across everyone. Read from secrets at call time; a missing or
 * malformed value falls back to the default.
 */
export function dailyCaps() {
  return {
    messagesPerUser: envNumber("ASSISTANT_DAILY_MESSAGES_PER_USER", 100),
    messagesGlobal: envNumber("ASSISTANT_DAILY_MESSAGES_GLOBAL", 1000),
    spendCentsGlobal: envNumber("ASSISTANT_DAILY_SPEND_CENTS_GLOBAL", 300),
  };
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
  const allowed = (Deno.env.get("ASSISTANT_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** JSON response with corsHeadersFor() — the new functions' counterpart to mod.ts's json(). */
export function respond(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeadersFor(req) },
  });
}
