import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, getUser, json, withSentry } from "../_shared/mod.ts";

/**
 * GYM-49: in-app account deletion — immediate hard delete, required by
 * App Store Guideline 5.1.1(v). Deleting the auth user cascades through
 * public.users into every user-owned table.
 */
Deno.serve(withSentry(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const user = await getUser(req);
  if (!user) return json(401, { error: "unauthorized" });

  const authAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await authAdmin.auth.admin.deleteUser(user.id);
  if (error) return json(500, { error: "delete_failed" });

  return json(200, { deleted: true });
}));
