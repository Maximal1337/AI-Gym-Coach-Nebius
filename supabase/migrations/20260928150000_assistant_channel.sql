-- The coach chat channel (NH-51 assistant-send, NH-52 assistant-outbox,
-- NH-53 assistant-deliver in docs/nebius-hackathon-plan.md).
--
--   app ──assistant-send──► assistant_messages + assistant_jobs
--   relay on the VPS ──assistant-outbox──► leases jobs, gets each one's context
--   relay ──assistant-deliver──► reply stored and job done, in one transaction
--
-- Every step that touches more than one row is one function here, so it
-- commits or fails as a whole. All of them are service_role only.

-- A reply points at the job that produced it. Unique, so a delivery the relay
-- retries (a lost response, a timeout) can never store the reply twice.
alter table public.assistant_messages
  add column job_id bigint unique references public.assistant_jobs (id) on delete set null,
  add constraint assistant_messages_job_reply_check check (job_id is null or role = 'assistant');

-- ------------------------------------------------------- enqueue (send)
-- Stores a user message and queues the agent turn for it. A client_message_id
-- seen before returns the original message instead (a retried send). Daily
-- caps count user messages per UTC day: p_user_cap for this account,
-- p_global_cap across everyone (_shared/assistant.ts dailyCaps).
create or replace function public.assistant_enqueue_message(
  p_user_id uuid,
  p_text text,
  p_client_message_id text,
  p_user_cap int,
  p_global_cap int
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_text text := btrim(p_text);
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'utc')) at time zone 'utc';
  v_message public.assistant_messages%rowtype;
  v_job public.assistant_jobs%rowtype;
  v_environment text;
begin
  if v_text is null or char_length(v_text) not between 1 and 2000
     or p_client_message_id is null or char_length(p_client_message_id) not between 1 and 100 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select m.* into v_message
  from public.assistant_messages m
  where m.user_id = p_user_id and m.role = 'user' and m.client_message_id = p_client_message_id;
  if found then
    select j.* into v_job from public.assistant_jobs j where j.message_id = v_message.id;
    return jsonb_build_object(
      'duplicate', true,
      'message', jsonb_build_object('id', v_message.id, 'created_at', v_message.created_at, 'doc', v_message.doc),
      'job_status', v_job.status
    );
  end if;

  if (select count(*) from public.assistant_messages
      where user_id = p_user_id and role = 'user' and created_at >= v_day_start) >= p_user_cap then
    raise exception 'user_daily_cap' using errcode = 'P0001';
  end if;
  if (select count(*) from public.assistant_messages
      where role = 'user' and created_at >= v_day_start) >= p_global_cap then
    raise exception 'global_daily_cap' using errcode = 'P0001';
  end if;

  v_environment := public.assistant_environment(p_user_id);
  insert into public.assistant_messages (user_id, role, doc, client_message_id)
  values (p_user_id, 'user', jsonb_build_object('text', v_text), p_client_message_id)
  returning * into v_message;
  insert into public.assistant_jobs (user_id, environment, kind, message_id)
  values (p_user_id, v_environment, 'chat', v_message.id)
  returning * into v_job;

  return jsonb_build_object(
    'duplicate', false,
    'message', jsonb_build_object('id', v_message.id, 'created_at', v_message.created_at, 'doc', v_message.doc),
    'job_status', v_job.status,
    'environment', v_environment
  );
end;
$$;

-- ------------------------------------------------------ context (outbox)
-- Everything the relay needs to run one job in the user's sandbox: the
-- message (null for a check-in), the recent conversation before it, the
-- user's facts (D-30: passed with every request, as data), reply language and
-- units, and the sandbox mapping (NH-55 provisions one when it's missing).
create or replace function public.assistant_job_context(p_job_id bigint, p_history int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job public.assistant_jobs%rowtype;
  v_message public.assistant_messages%rowtype;
  v_before timestamptz;
begin
  select * into v_job from public.assistant_jobs where id = p_job_id;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0001';
  end if;
  if v_job.message_id is not null then
    select * into v_message from public.assistant_messages where id = v_job.message_id;
  end if;
  v_before := coalesce(v_message.created_at, now());

  return jsonb_build_object(
    'job', jsonb_build_object('id', v_job.id, 'kind', v_job.kind, 'environment', v_job.environment,
                              'user_id', v_job.user_id, 'attempts', v_job.attempts),
    'message', case when v_job.message_id is null then null
                    else jsonb_build_object('id', v_message.id, 'text', v_message.doc ->> 'text',
                                            'created_at', v_message.created_at) end,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('role', h.role, 'text', h.doc ->> 'text', 'created_at', h.created_at)
                       order by h.created_at, h.id)
      from (
        select m.* from public.assistant_messages m
        where m.user_id = v_job.user_id and m.created_at < v_before
        order by m.created_at desc, m.id desc
        limit greatest(0, least(p_history, 50))
      ) h
    ), '[]'::jsonb),
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object('text', f.doc ->> 'text', 'category', f.doc ->> 'category', 'pinned', f.pinned)
                       order by f.pinned desc, f.score desc, f.id)
      from public.user_facts f where f.user_id = v_job.user_id
    ), '[]'::jsonb),
    'user', (
      select jsonb_build_object('language', coalesce(c.language, u.locale), 'units', coalesce(c.units, 'metric'),
                                'coach_name', c.coach_name, 'tone', c.tone_preset)
      from public.users u left join public.coach_profiles c on c.user_id = u.id
      where u.id = v_job.user_id
    ),
    'agent', (
      select jsonb_build_object('sandbox_name', a.sandbox_name, 'provisioned', a.provisioned_at is not null)
      from public.assistant_agents a where a.user_id = v_job.user_id
    )
  );
end;
$$;

-- ---------------------------------------------------- complete (deliver)
-- Stores the reply and finishes the job in one transaction. p_skip finishes
-- a job with no message (a check-in with nothing worth saying, NH-66).
-- Delivering an already delivered job returns the stored reply
-- (already_delivered) instead of storing it twice; a lease that is no longer
-- held (expired and reclaimed by another attempt) is lease_lost, and the
-- relay drops its result.
create or replace function public.assistant_complete_job(
  p_environment text,
  p_job_id bigint,
  p_lease_token uuid,
  p_doc jsonb,
  p_skip boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.assistant_jobs%rowtype;
  v_reply uuid;
  v_coach_name text;
begin
  select * into v_job from public.assistant_jobs
  where id = p_job_id and environment = p_environment
  for update;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0001';
  end if;

  if v_job.status = 'done' then
    select id into v_reply from public.assistant_messages where job_id = v_job.id;
    return jsonb_build_object('status', 'already_delivered', 'message_id', v_reply, 'user_id', v_job.user_id);
  end if;
  if v_job.status <> 'leased' or v_job.lease_token is distinct from p_lease_token then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;

  update public.assistant_jobs
  set status = 'done', lease_token = null, leased_until = null, last_error = null, updated_at = now()
  where id = v_job.id;

  if p_skip then
    return jsonb_build_object('status', 'skipped', 'user_id', v_job.user_id, 'kind', v_job.kind);
  end if;

  insert into public.assistant_messages (user_id, role, doc, job_id)
  values (v_job.user_id, 'assistant', p_doc || jsonb_build_object('kind', v_job.kind), v_job.id)
  returning id into v_reply;
  select coach_name into v_coach_name from public.coach_profiles where user_id = v_job.user_id;

  return jsonb_build_object('status', 'delivered', 'message_id', v_reply, 'user_id', v_job.user_id,
                            'kind', v_job.kind, 'coach_name', v_coach_name);
end;
$$;

revoke execute on function public.assistant_enqueue_message(uuid, text, text, int, int) from public, anon, authenticated;
revoke execute on function public.assistant_job_context(bigint, int) from public, anon, authenticated;
revoke execute on function public.assistant_complete_job(text, bigint, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.assistant_enqueue_message(uuid, text, text, int, int) to service_role;
grant execute on function public.assistant_job_context(bigint, int) to service_role;
grant execute on function public.assistant_complete_job(text, bigint, uuid, jsonb, boolean) to service_role;
