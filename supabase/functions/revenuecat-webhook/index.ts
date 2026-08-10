import { admin, corsHeaders, json, withSentry } from "../_shared/mod.ts";

/**
 * RevenueCat webhook receiver — the server-side half of the free-month
 * trial / subscription gate (subscriptionAccess() in _shared/mod.ts).
 * RevenueCat is the source of truth for what Apple actually billed; this
 * function's only job is mirroring that into public.users so the gate
 * check stays a cheap local read instead of an API call on every turn.
 *
 * Auth: RevenueCat sends whatever fixed string you configure as the
 * webhook's "Authorization header value" (Project Settings > Integrations
 * > Webhooks) on every request — set REVENUECAT_WEBHOOK_SECRET to that
 * same value and compare exactly. This is a shared secret, not a
 * signature — RevenueCat doesn't sign webhook payloads.
 *
 * app_user_id is expected to be the Supabase auth user id: the client
 * must call Purchases.configure/logIn with that id (see
 * apps/mobile/src/lib/subscription.ts), not RevenueCat's anonymous id.
 *
 * Event types acted on here: INITIAL_PURCHASE / RENEWAL / UNCANCELLATION /
 * PRODUCT_CHANGE mark the subscription active; CANCELLATION marks it
 * canceled (still entitled until subscription_expires_at — Apple keeps a
 * canceled sub live through the paid period); EXPIRATION marks it
 * expired. Every other type (BILLING_ISSUE, TRANSFER, TEST, ...) is
 * acknowledged but ignored — nothing here needs to react to them.
 */

const ACTIVE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "SUBSCRIPTION_EXTENDED",
]);
const CANCELED_EVENTS = new Set(["CANCELLATION"]);
const EXPIRED_EVENTS = new Set(["EXPIRATION"]);

Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== secret) return json(401, { error: "unauthorized" });

  let body: { event?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }

  const event = body.event;
  const type = event?.type;
  const userId = event?.app_user_id;
  if (typeof type !== "string" || typeof userId !== "string") {
    return json(400, { error: "invalid_input" });
  }

  let status: "active" | "canceled" | "expired" | null = null;
  if (ACTIVE_EVENTS.has(type)) status = "active";
  else if (CANCELED_EVENTS.has(type)) status = "canceled";
  else if (EXPIRED_EVENTS.has(type)) status = "expired";
  if (!status) return json(200, { ok: true, ignored: type });

  const expirationMs = event?.expiration_at_ms;
  const expiresAt = typeof expirationMs === "number" ? new Date(expirationMs).toISOString() : null;
  const originalAppUserId = event?.original_app_user_id;

  const db = admin();
  const { error } = await db
    .from("users")
    .update({
      subscription_status: status,
      subscription_expires_at: expiresAt,
      revenuecat_customer_id: typeof originalAppUserId === "string" ? originalAppUserId : userId,
    })
    .eq("id", userId);

  if (error) {
    // A user_id RevenueCat has that we don't (sandbox testing, a stale
    // anonymous id never logged in to Supabase) shows up as a no-op
    // update, not a Postgres error — this branch is a real failure.
    console.error("revenuecat-webhook: users update failed", { userId, type, error: error.message });
    return json(500, { error: "update_failed" });
  }

  return json(200, { ok: true });
}));
