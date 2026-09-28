-- The nightly memory job (NH-63 in docs/nebius-hackathon-plan.md).
--
-- Supabase Cron calls the memory-nightly Edge Function every 10 minutes from
-- 00:00 to 02:59 UTC (supabase/cron/assistant.sql). Each call takes the users
-- due today, processes as many as fit in the function's time limit, and
-- leaves the rest to the next call, so a run can't time out half-applied.
-- Everything here is service_role only.

alter table public.user_memory_state
  add column last_error text;

-- Users whose memory should be refreshed today: the assistant_memory flag is
-- on for them, they weren't processed yet today (UTC), and they either wrote
-- something since their watermark or have facts whose scores and expiry need
-- the daily refresh. Oldest run first.
create or replace function public.assistant_memory_due(p_limit int)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with today as (select (date_trunc('day', now() at time zone 'utc')) at time zone 'utc' as start),
  flagged as (
    select u.user_id
    from public.user_flags u
    join public.feature_flags f on f.flag = u.flag
    where u.flag = 'assistant_memory' and u.enabled and f.enabled
  )
  select fl.user_id
  from flagged fl
  join public.users usr on usr.id = fl.user_id
  left join public.user_memory_state s on s.user_id = fl.user_id
  cross join today
  where (s.last_run_at is null or s.last_run_at < today.start)
    and (
      exists (select 1 from public.user_facts uf where uf.user_id = fl.user_id)
      or exists (
        select 1 from public.assistant_messages m
        where m.user_id = fl.user_id and m.role = 'user'
          and m.created_at > coalesce(s.watermark, '-infinity') and m.created_at > now() - interval '14 days'
      )
      or exists (
        select 1 from public.messages m
        where m.user_id = fl.user_id and m.from_role = 'me'
          and m.created_at > coalesce(s.watermark, '-infinity') and m.created_at > now() - interval '14 days'
      )
    )
  order by s.last_run_at nulls first, fl.user_id
  limit greatest(0, least(p_limit, 100));
$$;

-- What one user's run reads: current facts in a stable order (the model refers
-- to them as f1, f2, … in this order), and the OLDEST unread messages from the
-- last 14 days — coach chat and workout chat, the user's and the coach's —
-- up to p_max_messages, so a backlog is worked through over several nights
-- instead of skipped. new_watermark is where this run's reading stops.
create or replace function public.assistant_memory_sources(p_user_id uuid, p_max_messages int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_watermark timestamptz;
  v_messages jsonb;
begin
  select watermark into v_watermark from public.user_memory_state where user_id = p_user_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'role', x.role, 'channel', x.channel, 'text', x.text, 'at', x.at)
                            order by x.at, x.id), '[]'::jsonb)
  into v_messages
  from (
    select * from (
      select m.id, case when m.role = 'user' then 'user' else 'coach' end as role, 'chat' as channel,
             m.doc ->> 'text' as text, m.created_at as at
      from public.assistant_messages m
      where m.user_id = p_user_id
      union all
      select m.id, case when m.from_role = 'me' then 'user' else 'coach' end, 'workout', m.text, m.created_at
      from public.messages m
      where m.user_id = p_user_id and m.from_role in ('me', 'coach')
    ) all_messages
    where all_messages.at > coalesce(v_watermark, '-infinity') and all_messages.at > now() - interval '14 days'
    order by all_messages.at, all_messages.id
    limit greatest(0, least(p_max_messages, 500))
  ) x;

  return jsonb_build_object(
    'watermark', v_watermark,
    'new_watermark', coalesce((select max((e ->> 'at')::timestamptz) from jsonb_array_elements(v_messages) e), v_watermark),
    'language', (select coalesce(c.language, u.locale, 'en')
                 from public.users u left join public.coach_profiles c on c.user_id = u.id where u.id = p_user_id),
    'facts', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'doc', f.doc, 'pinned', f.pinned) order by f.created_at, f.id)
                       from public.user_facts f where f.user_id = p_user_id), '[]'::jsonb),
    'messages', v_messages
  );
end;
$$;

-- Applies one user's MemoryWrite (_shared/memory-extraction.ts) in one
-- transaction, in the order that keeps the caps on user_facts from ever
-- tripping: removals, updates that unpin, inserts, updates that pin. A fact
-- the user deleted while the run was in flight is simply not updated — their
-- deletion wins. The watermark only moves forward.
create or replace function public.assistant_memory_apply(
  p_user_id uuid,
  p_remove uuid[],
  p_updates jsonb,
  p_inserts jsonb,
  p_watermark timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_removed int;
  v_inserted int;
  u jsonb;
begin
  delete from public.user_facts where user_id = p_user_id and id = any(coalesce(p_remove, '{}'));
  get diagnostics v_removed = row_count;

  for u in select * from jsonb_array_elements(coalesce(p_updates, '[]')) where not coalesce((value ->> 'pinned')::boolean, false) loop
    update public.user_facts
    set doc = coalesce(u -> 'doc', doc), score = (u ->> 'score')::numeric, pinned = false, updated_at = now()
    where id = (u ->> 'id')::uuid and user_id = p_user_id;
  end loop;

  insert into public.user_facts (user_id, doc, score, pinned)
  select p_user_id, i -> 'doc', (i ->> 'score')::numeric, coalesce((i ->> 'pinned')::boolean, false)
  from jsonb_array_elements(coalesce(p_inserts, '[]')) i;
  get diagnostics v_inserted = row_count;

  for u in select * from jsonb_array_elements(coalesce(p_updates, '[]')) where coalesce((value ->> 'pinned')::boolean, false) loop
    update public.user_facts
    set doc = coalesce(u -> 'doc', doc), score = (u ->> 'score')::numeric, pinned = true, updated_at = now()
    where id = (u ->> 'id')::uuid and user_id = p_user_id;
  end loop;

  insert into public.user_memory_state as s (user_id, last_run_at, watermark, last_error)
  values (p_user_id, now(), p_watermark, null)
  on conflict (user_id) do update
    set last_run_at = now(),
        watermark = case when excluded.watermark is null then s.watermark
                         else greatest(coalesce(s.watermark, excluded.watermark), excluded.watermark) end,
        last_error = null,
        updated_at = now();

  return jsonb_build_object('removed', v_removed, 'inserted', v_inserted,
                            'facts', (select count(*) from public.user_facts where user_id = p_user_id));
end;
$$;

-- A run that failed for this user: counted as today's run (no retry storm, no
-- repeated spend), watermark untouched so tomorrow reads the same messages.
create or replace function public.assistant_memory_mark_failed(p_user_id uuid, p_error text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.user_memory_state as s (user_id, last_run_at, last_error)
  values (p_user_id, now(), left(p_error, 2000))
  on conflict (user_id) do update set last_run_at = now(), last_error = left(p_error, 2000), updated_at = now();
$$;

revoke execute on function public.assistant_memory_due(int) from public, anon, authenticated;
revoke execute on function public.assistant_memory_sources(uuid, int) from public, anon, authenticated;
revoke execute on function public.assistant_memory_apply(uuid, uuid[], jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.assistant_memory_mark_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.assistant_memory_due(int) to service_role;
grant execute on function public.assistant_memory_sources(uuid, int) to service_role;
grant execute on function public.assistant_memory_apply(uuid, uuid[], jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.assistant_memory_mark_failed(uuid, text) to service_role;

-- ------------------------------------------- demo accounts start clean
-- Re-seeding a demo or judge account right before judging must also clear
-- what testing left in the coach chat: messages, queued work, the action
-- trail, facts and memory state (so the first nightly run rebuilds facts from
-- the seeded history, the way a real user's would be). The sandbox mapping
-- stays; resetting the sandbox itself belongs to the sandbox manager (NH-55).
-- The original seed is kept as-is under a new name and wrapped.
alter function private.seed_demo_account(text) rename to seed_demo_account_base;

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
  return v_result || jsonb_build_object('assistant_cleared', true);
end;
$$;

revoke all on function private.seed_demo_account(text) from public, anon, authenticated;
revoke all on function private.seed_demo_account_base(text) from public, anon, authenticated;
