-- The proactive daily check-in (NH-66, D-21 in docs/nebius-hackathon-plan.md):
-- the assistant writes first, once a day, about today's workout and something
-- it remembers — "always-on" is half of what the Personal AI track asks for.
--
-- Supabase Cron calls assistant_enqueue_checkins() every morning
-- (supabase/cron/assistant.sql). Each opted-in user gets one 'checkin' job in
-- their environment's queue; the relay runs it in their sandbox, and the agent
-- answers SKIP when there's nothing worth saying (services/relay). Replies go
-- through assistant-deliver like any other, with a push notification, inside
-- the D-34 spend ceilings.

-- Opt-in per account, on top of assistant_chat: a check-in is only sent to a
-- user who has both.
insert into public.feature_flags (flag, enabled, description) values
  ('assistant_checkin', true, 'Proactive daily check-in from the coach chat (needs assistant_chat too)')
on conflict (flag) do nothing;

-- Queues today's check-ins and returns how many were queued. Safe to run more
-- than once a day: dedup_key 'checkin:YYYY-MM-DD' makes it a no-op. A check-in
-- from an earlier day that never went out (the relay was down, or the spend
-- ceiling was reached) is failed as stale rather than sent a day late.
create or replace function public.assistant_enqueue_checkins(p_day date default (now() at time zone 'utc')::date)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.assistant_jobs
  set status = 'failed', last_error = 'stale: not sent on its day', lease_token = null, leased_until = null, updated_at = now()
  where kind = 'checkin' and status = 'pending' and dedup_key < 'checkin:' || to_char(p_day, 'YYYY-MM-DD');

  insert into public.assistant_jobs (user_id, environment, kind, dedup_key)
  select c.user_id, public.assistant_environment(c.user_id), 'checkin', 'checkin:' || to_char(p_day, 'YYYY-MM-DD')
  from public.user_flags c
  join public.users u on u.id = c.user_id
  where c.flag = 'assistant_checkin'
    and public.feature_enabled(c.user_id, 'assistant_checkin')
    and public.feature_enabled(c.user_id, 'assistant_chat')
  on conflict (user_id, dedup_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.assistant_enqueue_checkins(date) from public, anon, authenticated;
grant execute on function public.assistant_enqueue_checkins(date) to service_role;
