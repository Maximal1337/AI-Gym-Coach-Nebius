-- v3 of dev_test_reset_account: the QA-scenario allowlist moves out of the
-- repository (NH-06).
--
-- v2 (20260810141500) hardcoded the QA accounts' emails in the function
-- body. The repository is going public, and every one of those addresses is
-- an instant-sign-in credential (dev-test-login skips the one-time code for
-- them), so the email → scenario mapping now lives in a table inside a
-- schema PostgREST doesn't expose. Rows are managed out of band (SQL editor
-- or `supabase db query`) and never committed — see the
-- dev-test-scenario-accounts skill.
--
-- v2's safety property is kept: the account AND its scenario are resolved
-- inside the function from data no caller can write, never from a
-- parameter, so it stays safe to grant broadly (see the
-- postgrest-security-definer-writes skill for why it has to be granted that
-- way here). An email with no row is a no-op, exactly like v2's `else null`.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.dev_test_accounts (
  email text primary key check (email = lower(email)),
  scenario text not null check (scenario in ('active', 'expired', 'fresh')),
  created_at timestamptz not null default now()
);

revoke all on private.dev_test_accounts from public, anon, authenticated;

create or replace function public.dev_test_reset_account(
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_scenario text;
begin
  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then
    return;
  end if;

  select scenario into v_scenario from private.dev_test_accounts where email = v_email;
  if v_scenario is null then
    return; -- not an allowlisted QA account — no-op, never touches a real user
  end if;

  if v_scenario = 'fresh' then
    delete from public.users where id = p_user_id;
    return;
  end if;

  insert into public.users (id, terms_accepted_at, terms_version, plan_setup_skipped_at)
  values (p_user_id, now(), 'dev-test', now())
  on conflict (id) do update set
    terms_accepted_at = excluded.terms_accepted_at,
    terms_version = excluded.terms_version,
    plan_setup_skipped_at = excluded.plan_setup_skipped_at;

  insert into public.coach_profiles (user_id, coach_name, language, tone_preset, accountability_style)
  values (p_user_id, 'Notch', 'en', 'friendly_casual', 'gentle')
  on conflict (user_id) do nothing;

  update public.users set
    subscription_status = case when v_scenario = 'expired' then 'expired' else 'trialing' end,
    trial_ends_at = now() + (case when v_scenario = 'expired' then -1 else 30 end) * interval '1 day',
    subscription_expires_at = null
  where id = p_user_id;
end;
$$;

grant execute on function public.dev_test_reset_account(uuid) to anon, authenticated, service_role;
