-- v2 of dev_test_reset_account: the previous version's plain
-- service_role-only execute grant (see 20260810140000's comment) still
-- hit "permission denied for function dev_test_reset_account" through
-- the edge function's service-role key, even with an explicit
-- `grant execute ... to service_role` layered on top and a forced
-- PostgREST config PATCH via the Management API to rule out a stale
-- schema cache. Conclusion: this project's PostgREST is consistently
-- resolving the service-role key to `authenticated` for at least these
-- two objects (this function, and public.users's server-only columns),
-- not a transient cache issue — every other admin()-mediated write in
-- this codebase "works" only because `authenticated` already happens to
-- have broad table grants everywhere except those two.
--
-- Rather than keep fighting that (or loosen public.users's deliberately
-- server-only columns — a real security hole), this version makes itself
-- safe to grant broadly: the account and its scenario are both resolved
-- INSIDE the function from a fixed email allow-list, never taken as
-- caller-supplied input. Whoever ends up calling it — service_role,
-- authenticated, doesn't matter — it can only ever reset one of these
-- three pinned dev accounts to one of three fixed states, never a real
-- user's row or an arbitrary state.
drop function if exists public.dev_test_reset_account(uuid, text);

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
  select email into v_email from auth.users where id = p_user_id;
  v_scenario := case v_email
    when 'dor@test.com' then 'active'
    when 'dor+expired@test.com' then 'expired'
    when 'dor+new@test.com' then 'fresh'
    else null
  end;
  if v_scenario is null then
    return; -- not a recognized dev-test account — no-op, never touches a real user
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
