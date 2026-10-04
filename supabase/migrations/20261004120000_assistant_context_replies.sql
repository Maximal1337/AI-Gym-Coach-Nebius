-- The job context's history keeps the coach's own replies (NH-52, NH-54 in
-- docs/nebius-hackathon-plan.md).
--
-- History was the messages stored before the one being answered. When a user
-- sends two messages before the first is answered, the reply to the first is
-- stored after the second, so the second turn's history left it out: the
-- agent saw "hi", then "how was my week?", and no sign it had already
-- answered — and could answer the first again. The queue runs one job per
-- user at a time, in order, so every assistant reply that exists when a job
-- runs belongs to an earlier turn (or a check-in) and goes in; a user message
-- sent after the one being answered is a later turn and stays out.
--
-- Same function otherwise; CREATE OR REPLACE keeps its service_role-only grants.
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
        where m.user_id = v_job.user_id
          and (m.created_at < v_before or m.role = 'assistant')
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
                                'coach_name', c.coach_name, 'tone', c.tone_preset,
                                'accountability', c.accountability_style,
                                'persona', nullif(left(btrim(c.persona_freeform), 500), ''))
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
