import { admin, corsHeaders, json, withSentry } from "../_shared/mod.ts";

/**
 * Dev-only instant sign-in for one hardcoded test account. Generates a
 * valid one-time code server-side and verifies it in the same request,
 * so the client gets back a real session without an email ever being
 * sent — useful for testing in Expo Go while custom SMTP isn't wired up
 * yet (the default mailer can't show a code in its email on this
 * project's plan, see history-import's sibling context).
 *
 * The email is checked here, server-side — this is the actual security
 * boundary. The mobile client only surfaces the button behind `__DEV__`,
 * but that's a UI nicety, not what makes this safe to deploy: anything
 * other than the one allowed address is rejected outright, so this can
 * never be used to sign in as a real user's account.
 */
const ALLOWED_EMAIL = "dor@test.com";

Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_input" });
  }
  if (body.email !== ALLOWED_EMAIL) return json(403, { error: "not_allowed" });

  const db = admin();

  // shouldCreateUser defaults true — first call ever for this address
  // creates the account, same as the real signInWithOtp path would.
  const { data: link, error: linkError } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: ALLOWED_EMAIL,
  });
  if (linkError || !link?.properties?.email_otp) {
    return json(500, { error: "generate_failed" });
  }

  const { data: verified, error: verifyError } = await db.auth.verifyOtp({
    email: ALLOWED_EMAIL,
    token: link.properties.email_otp,
    type: "email",
  });
  if (verifyError || !verified.session) {
    return json(500, { error: "verify_failed" });
  }

  return json(200, {
    accessToken: verified.session.access_token,
    refreshToken: verified.session.refresh_token,
  });
}));
