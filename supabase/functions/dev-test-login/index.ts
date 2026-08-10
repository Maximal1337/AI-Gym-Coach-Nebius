import { admin, corsHeaders, json, withSentry } from "../_shared/mod.ts";

/**
 * Dev-only instant sign-in for a small set of hardcoded test accounts,
 * each pinned to a deterministic subscription/onboarding state. Generates
 * a valid one-time code server-side and verifies it in the same request,
 * so the client gets back a real session without an email ever being
 * sent — useful for testing in Expo Go while custom SMTP isn't wired up
 * yet (the default mailer can't show a code in its email on this
 * project's plan, see history-import's sibling context).
 *
 * The email is checked here, server-side — this is the actual security
 * boundary. The mobile client only surfaces the buttons behind `__DEV__`,
 * but that's a UI nicety, not what makes this safe to deploy: anything
 * other than one of the allowed addresses is rejected outright, so this
 * can never be used to sign in as a real user's account.
 *
 * Each account's state is RESET on every single login, not just created
 * once — otherwise "the expired one" would drift as soon as you actually
 * used the app with it (finish onboarding, a webhook fires, etc.), and
 * stop reliably reproducing the scenario it's named for. The reset itself
 * runs through the dev_test_reset_account(uuid) RPC — see that
 * function's own comment (20260810141500 migration) for why it's a
 * security-definer function with the account/scenario resolved from a
 * fixed allow-list inside the function body, not direct table writes.
 */
const TEST_EMAILS = new Set(["dor@test.com", "dor+expired@test.com", "dor+new@test.com"]);

Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }
  const email = body.email;
  if (!email || !TEST_EMAILS.has(email)) return json(403, { error: "not_allowed" });

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
