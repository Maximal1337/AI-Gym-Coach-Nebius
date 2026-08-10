-- Dev-only RPC backing dev-test-login's per-scenario account reset.
-- Direct PostgREST PATCH/POST to public.users for columns without an
-- explicit `authenticated` column grant (trial_ends_at, subscription_*,
-- terms_accepted_at) was returning "permission denied for table users"
-- even through the service-role key — some quirk in how this project's
-- PostgREST resolves privileges for that specific table, not an actual
-- Postgres grant issue (confirmed: service_role has full table+column
-- grants via SET ROLE service_role in a direct session). security definer
-- sidesteps it the same way record_usage/bump_rate already do: the
-- function runs with the DEFINER's privileges, not the caller's, so it's
-- immune to whatever the REST-layer role resolution is doing.
--
-- Superseded by 20260810141500_dev_test_reset_account_v2.sql — see that
-- file for why this version's plain service_role-only execute grant
-- turned out not to be enough either, and what changed.
create or replace function public.dev_test_reset_account(
  p_user_id uuid,
  p_scenario text -- 'active' | 'expired' | 'fresh'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_scenario = 'fresh' then
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
    subscription_status = case when p_scenario = 'expired' then 'expired' else 'trialing' end,
    trial_ends_at = now() + (case when p_scenario = 'expired' then -1 else 30 end) * interval '1 day',
    subscription_expires_at = null
  where id = p_user_id;
end;
$$;

revoke execute on function public.dev_test_reset_account(uuid, text) from public, anon, authenticated;
