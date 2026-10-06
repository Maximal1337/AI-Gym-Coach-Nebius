-- Demo and judge accounts get the daily check-in (NH-13, NH-66 in
-- docs/nebius-hackathon-plan.md).
--
-- The seed turned on assistant_chat and assistant_memory, but a check-in is
-- queued only for accounts that also have assistant_checkin, and nothing in
-- the demo runbook added it: the judges, whose instructions promise a daily
-- check-in, would never have had one — and it's the clearest demo of the
-- always-on half of the track (D-21).
--
-- The same wrapper as 20260928160000_memory_job.sql, plus the flag.
-- CREATE OR REPLACE keeps its grants (none: private schema, revoked below too).
create or replace function private.seed_demo_account(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_uid uuid;
begin
  -- The base function does every safety check (registered demo account, not
  -- a QA account, auth user exists) before wiping anything.
  v_result := private.seed_demo_account_base(p_email);
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  delete from public.assistant_jobs where user_id = v_uid;
  delete from public.assistant_messages where user_id = v_uid;
  delete from public.assistant_actions where user_id = v_uid;
  delete from public.user_facts where user_id = v_uid;
  delete from public.user_memory_state where user_id = v_uid;
  insert into public.user_flags (user_id, flag, enabled)
  values (v_uid, 'assistant_checkin', true)
  on conflict (user_id, flag) do update set enabled = true, updated_at = now();
  return v_result || jsonb_build_object('assistant_cleared', true);
end;
$$;

revoke all on function private.seed_demo_account(text) from public, anon, authenticated;
