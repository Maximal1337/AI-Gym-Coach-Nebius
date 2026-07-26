import { admin, corsHeaders, getUser, json } from "../_shared/mod.ts";

/**
 * GYM-46: record legal consent. Server-written by design — the client has
 * no column grant on terms_accepted_at/terms_version, so the consent
 * audit trail can only be produced by this endpoint.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  let version: string;
  try {
    ({ version } = await req.json());
    if (typeof version !== "string" || version.length < 1 || version.length > 40) {
      throw new Error();
    }
  } catch {
    return json(400, { error: "invalid_input" });
  }

  const db = admin();
  // Bootstrap the profile row if this is the user's first action.
  const { error } = await db.from("users").upsert({
    id: user.id,
    terms_accepted_at: new Date().toISOString(),
    terms_version: version,
  });
  if (error) return json(500, { error: "write_failed" });

  return json(200, { accepted: true, version });
});
