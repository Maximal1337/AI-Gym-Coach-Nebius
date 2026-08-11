---
name: postgrest-security-definer-writes
description: Diagnose and fix "permission denied for table X" / "permission denied for function X" (SQLSTATE 42501) from a Supabase Edge Function's admin() service-role client, when a direct SQL session as service_role proves the grants are actually fine. Use whenever an admin()-mediated write or RPC call fails with a 42501 despite correct-looking grants.
---

# When service_role writes fail through PostgREST but work via direct SQL

Hit this building the dev-test-login scenario-reset feature: `admin()`'s
`db.from("users").update({...})` and a brand-new `security definer`
function both returned `permission denied for table/function X`, with a
`hint` literally suggesting `GRANT ... TO authenticated` — even though
`information_schema.role_table_grants` showed `service_role` already had
full INSERT/UPDATE on the table, and a raw `SET ROLE service_role; UPDATE
...;` via a direct connection succeeded instantly with the exact same
statement.

## Diagnosis, in order — don't skip to a fix before confirming which layer is broken

1. **Confirm the grant is real at the Postgres level**, not just assumed:
   ```sql
   select grantee, privilege_type from information_schema.role_table_grants
     where table_schema='public' and table_name='<table>' and grantee='service_role';
   ```
   (For a function: `information_schema.routine_privileges`.)

2. **Confirm service_role can genuinely do the write**, independent of the
   REST layer:
   ```bash
   supabase db query --linked "SET ROLE service_role; <the failing statement>; RESET ROLE;"
   ```
   If this succeeds, the DB-level ACL is proven fine — the bug is
   specifically in how PostgREST resolves the request's role, not in
   Postgres grants. Stop looking at grants/RLS at this point; they're not
   the problem.

3. **Get the real PostgrestError detail**, not just `.message` — `.details`,
   `.hint`, and `.code` often name the exact role PostgREST thinks it's
   running as. A generic `console.error(error.message)` hides this; log or
   temporarily return the full object while diagnosing.

## What this project's actual behavior turned out to be

PostgREST here consistently resolved the edge function's service-role key
to `authenticated` for at least two kinds of objects: a table's
deliberately server-only columns (ones `authenticated` was explicitly never
granted), and a freshly-created function with no explicit grant beyond
whatever a bare `create function` gives by default. It was **not** a
transient schema-cache issue — all of these were tried and made no
difference: `select pg_notify('pgrst','reload schema')` / raw `NOTIFY pgrst,
'reload schema'`, a no-op `comment on column` DDL touch (meant to trigger
Supabase's DDL-event-trigger auto-reload), and a genuine no-op
`PATCH /v1/projects/{ref}/postgrest` via the Management API (confirmed
200, no effect). Every *other* admin()-mediated write in this codebase
"worked" throughout the same session only because `authenticated` already
happened to have broad table-level grants on those other tables (check with
the same `role_table_grants` query, `grantee='authenticated'`, to see what's
actually exposed) — not because service_role was resolving correctly there
either.

## The fix: `security definer`, with an EXPLICIT grant

Wrap the write in a Postgres function marked `security definer` — it runs
with the function *owner's* privileges, not the calling role's, so it's
immune to whatever the REST-layer role resolution is doing. This project
already had two examples of this pattern (`record_usage`, `bump_rate` in
`_shared/mod.ts`'s migrations) that worked throughout, which is what made
the new function's failure surprising until traced further.

**Don't assume a new function inherits the same default privileges older
ones have** — those may have been covered by an `ALTER DEFAULT PRIVILEGES`
rule set up once, historically, that doesn't necessarily apply going
forward. Add the grant explicitly:
```sql
create or replace function public.my_privileged_fn(...) returns void
language plpgsql security definer set search_path = public
as $$ ... $$;

grant execute on function public.my_privileged_fn(<arg_types>) to service_role;
```
(`to authenticated, service_role` etc. as needed — see the next section for
when broader is actually fine.)

## If you're not sure the intended caller will resolve correctly either

Given even `service_role` didn't reliably resolve through PostgREST here,
don't bet the function's safety on "only service_role can call this."
Instead, make the function **safe regardless of caller** by resolving its
target from a fixed, hardcoded allow-list *inside* the function body,
rather than trusting a caller-supplied parameter for anything sensitive
(e.g. resolve which test account + which state-reset scenario from the
account's own `email`, looked up inside the function, not passed in as an
argument). That makes it safe to grant broadly (`anon, authenticated,
service_role`) without needing to fully trust the role-resolution layer to
gate it correctly — the function's own logic is the real boundary.

## Editing an already-applied migration doesn't work

`supabase db push` tracks applied migrations by filename — editing the
*content* of a migration file that's already been pushed does nothing on
`db push` (it's considered already-applied and skipped). If a function's
`security definer` body needs a fix after it's shipped, add a **new**
migration file with `create or replace function` (and `drop function
if exists <old signature>` first if the parameter list itself changed —
Postgres identifies functions by name **and** parameter types, so a
different signature creates a second overload rather than replacing the
first).
