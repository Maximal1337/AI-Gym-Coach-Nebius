-- The sandbox manager's side of the queue (NH-55, NH-56 in
-- docs/nebius-hackathon-plan.md). The relay has no database credentials
-- (D-27): these functions are service_role only and reached through
-- assistant-outbox, signed per environment.
--
-- 1. Deferring a job. When a user's sandbox can't run yet — every running
--    slot busy (D-31: 4 in prod, 2 in dev), or it's still starting — the
--    relay hands the job back without spending an attempt, with a not_before
--    so it isn't claimed again at once. A user's messages still go in order:
--    the claim looks at each user's oldest open job and skips the user while
--    that one is deferred, instead of jumping to their next message.
-- 2. Recording a sandbox. Before creating a user's sandbox the relay records
--    its name and the digest of the tool token it's about to install, so a
--    sandbox never exists without its mapping row — the orphan sweep (NH-56)
--    deletes any sandbox whose row is gone, e.g. after an account deletion.
-- 3. Listing an environment's sandboxes, for that sweep.

alter table public.assistant_jobs add column not_before timestamptz;

create or replace function public.assistant_claim_jobs(
  p_environment text,
  p_limit int,
  p_lease_seconds int
)
returns setof public.assistant_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_environment not in ('dev', 'prod') then
    raise exception 'unknown environment %', p_environment using errcode = '22023';
  end if;
  if p_limit not between 1 and 100 or p_lease_seconds not between 10 and 3600 then
    raise exception 'limit or lease out of range' using errcode = '22023';
  end if;

  update public.assistant_jobs
  set status = 'failed',
      lease_token = null,
      leased_until = null,
      last_error = coalesce(last_error, 'lease expired'),
      updated_at = now()
  where environment = p_environment
    and status = 'leased'
    and leased_until <= now()
    and attempts >= max_attempts;

  return query
  with candidates as (
    -- Each user's oldest open job, deferred or not: a deferred one holds the
    -- user's place in line rather than letting a later message overtake it.
    select distinct on (j.user_id) j.id, j.created_at, j.not_before
    from public.assistant_jobs j
    where j.environment = p_environment
      and (j.status = 'pending' or (j.status = 'leased' and j.leased_until <= now()))
      and not exists (
        select 1
        from public.assistant_jobs l
        where l.user_id = j.user_id
          and l.status = 'leased'
          and l.leased_until > now()
      )
    order by j.user_id, j.created_at, j.id
  ),
  picked as (
    select j.id
    from public.assistant_jobs j
    join candidates c on c.id = j.id
    where c.not_before is null or c.not_before <= now()
    order by c.created_at, j.id
    limit p_limit
    for update of j skip locked
  ),
  leased as (
    update public.assistant_jobs j
    set status = 'leased',
        attempts = j.attempts + 1,
        lease_token = gen_random_uuid(),
        leased_until = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    from picked
    where j.id = picked.id
    returning j.*
  )
  select * from leased order by created_at, id;
end;
$$;

-- Hands a leased job back without spending the attempt its claim counted.
-- False when the lease isn't this caller's any more (or never was).
create or replace function public.assistant_defer_job(
  p_environment text,
  p_job_id bigint,
  p_lease_token uuid,
  p_seconds int,
  p_reason text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update public.assistant_jobs
  set status = 'pending',
      attempts = greatest(attempts - 1, 0),
      lease_token = null,
      leased_until = null,
      not_before = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 30), 1), 3600)),
      last_error = left(p_reason, 200),
      updated_at = now()
  where id = p_job_id
    and environment = p_environment
    and status = 'leased'
    and lease_token = p_lease_token
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

-- Records the sandbox the relay is about to create for a user, and the digest
-- of the tool token it will install. A relay only records sandboxes of its
-- own environment, named for it, for users routed to it.
--   recorded | user_gone (account deleted meanwhile) | wrong_environment
create or replace function public.assistant_agent_record(
  p_environment text,
  p_user_id uuid,
  p_sandbox_name text,
  p_token_hash text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_environment not in ('dev', 'prod')
     or p_sandbox_name is null or p_sandbox_name not like 'notch-' || p_environment || '-%' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    return 'user_gone';
  end if;
  if public.assistant_environment(p_user_id) <> p_environment then
    return 'wrong_environment';
  end if;

  insert into public.assistant_agents as a (user_id, environment, sandbox_name, tool_token_hash, provisioned_at)
  values (p_user_id, p_environment, p_sandbox_name, p_token_hash, now())
  on conflict (user_id) do update
    set sandbox_name = excluded.sandbox_name,
        tool_token_hash = excluded.tool_token_hash,
        provisioned_at = now(),
        updated_at = now();
  return 'recorded';
end;
$$;

-- Every sandbox an environment should have. The sweep deletes the rest.
create or replace function public.assistant_agents_list(p_environment text)
returns table (user_id uuid, sandbox_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id, a.sandbox_name
  from public.assistant_agents a
  where a.environment = p_environment and a.sandbox_name is not null
  order by a.sandbox_name;
$$;

revoke execute on function public.assistant_defer_job(text, bigint, uuid, int, text) from public, anon, authenticated;
revoke execute on function public.assistant_agent_record(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.assistant_agents_list(text) from public, anon, authenticated;
grant execute on function public.assistant_defer_job(text, bigint, uuid, int, text) to service_role;
grant execute on function public.assistant_agent_record(text, uuid, text, text) to service_role;
grant execute on function public.assistant_agents_list(text) to service_role;
