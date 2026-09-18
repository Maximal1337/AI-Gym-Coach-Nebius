import { admin, corsHeaders, json, withSentry } from "../_shared/mod.ts";

/**
 * Instant sign-in for a small allowlist of accounts that can't receive a
 * one-time code. Generates a valid one-time code server-side and verifies
 * it in the same request, so the client gets back a real session without
 * an email ever being sent. Two purposes share this endpoint:
 *  - Dev QA scenario accounts, each pinned to a deterministic
 *    subscription/onboarding state and RESET on every login — see below.
 *  - Apple App Review and demo/judge accounts — a reviewer has no inbox to
 *    receive a real one-time code in, so apps/mobile/app/sign-in.tsx asks
 *    this endpoint first for addresses on its instant-sign-in domain, in
 *    every build, not just __DEV__. These are deliberately NOT in the reset
 *    table: they behave like ordinary accounts (real onboarding, real data),
 *    which is the more representative review path.
 *
 * The allowlist is the DEV_TEST_LOGIN_EMAILS secret (comma-separated), never
 * the repository: the repository is public, and every allowlisted address
 * is an instant-sign-in credential. Use random, non-guessable addresses.
 * The check here, server-side, is the actual security boundary — anything
 * not on the list is rejected outright, and an unset secret rejects
 * everything, so this can never be used to sign in as a real user's account.
 *
 * Each QA account's state is RESET on every single login, not just created
 * once — otherwise "the expired one" would drift as soon as you actually
 * used the app with it (finish onboarding, a webhook fires, etc.), and stop
 * reliably reproducing the scenario it's named for. The reset runs through
 * the dev_test_reset_account(uuid) RPC, which resolves the scenario from
 * private.dev_test_accounts inside the function body (20260918120000
 * migration) — an allowlisted address with no row there is simply not reset.
 */
function allowedEmails(): Set<string> {
  return new Set(
    (Deno.env.get("DEV_TEST_LOGIN_EMAILS") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !allowedEmails().has(email)) return json(403, { error: "not_allowed" });

  const db = admin();

  // shouldCreateUser defaults true — first call ever for this address
  // creates the account, same as the real signInWithOtp path would.
  const { data: link, error: linkError } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.email_otp) {
    return json(500, { error: "generate_failed" });
  }

  const { data: verified, error: verifyError } = await db.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (verifyError || !verified.session) {
    return json(500, { error: "verify_failed" });
  }

  const { error: resetError } = await db.rpc("dev_test_reset_account", {
    p_user_id: verified.session.user.id,
  });
  if (resetError) {
    console.error("dev-test-login: scenario reset failed", { email, error: resetError.message });
  }

  return json(200, {
    accessToken: verified.session.access_token,
    refreshToken: verified.session.refresh_token,
  });
}));
