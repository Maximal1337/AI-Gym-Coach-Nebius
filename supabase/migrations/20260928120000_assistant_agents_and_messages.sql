-- Coach chat plumbing (NH-41, NH-50 in docs/nebius-hackathon-plan.md).
--
-- Every flagged user gets their own Hermes agent in their own OpenShell
-- sandbox on the Nebius VPS (D-26). The VPS accepts no inbound traffic
-- (D-27): a relay there pulls work from assistant_jobs through Edge
-- Functions and posts replies back, so Supabase stays the source of truth.
--
-- Access model, same as the rest of the schema: clients read their own
-- messages; every write goes through Edge Functions on the service_role
-- client. assistant_agents and assistant_jobs have no client access at all.

-- ------------------------------------------------------ assistant_agents
-- One row per user who has (or is about to get) a sandbox. The row can be
-- created out of band before the first message to route a team account to
-- the dev environment:
--   insert into public.assistant_agents (user_id, environment) values ('<uuid>', 'dev');
-- Users without a row are routed to prod. The relay fills in sandbox_name
-- and tool_token_hash when it provisions the sandbox (NH-55).
--
-- The tool token is the bearer token the user's sandbox presents to
-- notch-tools (NH-42); the OpenShell gateway injects it, so the agent never
-- sees it (D-28). Only its SHA-256 hex digest is stored, and it resolves to a
-- user id and nothing else — it never grants database access.
--
-- Deleting the user cascades this row away; the sandbox manager destroys
-- sandboxes that no longer have a row (NH-56).
create table public.assistant_agents (
  user_id uuid primary key references public.users (id) on delete cascade,
  environment text not null default 'prod' check (environment in ('dev', 'prod')),
  sandbox_name text unique check (sandbox_name ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  tool_token_hash text unique check (tool_token_hash ~ '^[0-9a-f]{64}$'),
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((sandbox_name is null) = (provisioned_at is null))
);

alter table public.assistant_agents enable row level security;
revoke all on public.assistant_agents from anon, authenticated;
grant all on public.assistant_agents to service_role;

-- Resolves a tool token's digest to its user (NH-41). Security definer with
-- explicit grants, like feature_enabled() — see the
-- postgrest-security-definer-writes skill.
create or replace function public.assistant_user_for_tool_token(p_token_hash text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.assistant_agents where tool_token_hash = p_token_hash;
$$;

revoke execute on function public.assistant_user_for_tool_token(text) from public, anon, authenticated;
grant execute on function public.assistant_user_for_tool_token(text) to service_role;

-- Environment a user's work is routed to: their assistant_agents row, or
-- prod when there is none.
create or replace function public.assistant_environment(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select environment from public.assistant_agents where user_id = p_user_id), 'prod');
$$;

revoke execute on function public.assistant_environment(uuid) from public, anon, authenticated;
grant execute on function public.assistant_environment(uuid) to service_role;

-- ---------------------------------------------------- assistant_messages
-- The coach chat transcript. doc is a JSONB document (D-12) so the shape can
-- grow without migrations: at minimum { "text": ... }; assistant replies also
-- carry e.g. "sources" (Tavily citations), "actions" (assistant_actions ids)
-- and "kind" ("chat" or "checkin").
create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- coalesce: a missing key makes the expression NULL, and a CHECK that
  -- evaluates to NULL passes.
  doc jsonb not null check (coalesce(
    jsonb_typeof(doc) = 'object'
    and jsonb_typeof(doc -> 'text') = 'string'
    and char_length(doc ->> 'text') between 1 and 8000,
    false
  )),
  -- Set by the client on send. The unique index below is the duplicate-send
  -- guard: a retried POST can't store the same user message twice or queue a
  -- second agent turn for it (NH-51).
  client_message_id text check (char_length(client_message_id) between 1 and 100),
  created_at timestamptz not null default now()
);

create index assistant_messages_user_created_idx
  on public.assistant_messages (user_id, created_at desc);

create unique index assistant_messages_client_message_id_idx
  on public.assistant_messages (user_id, client_message_id)
  where role = 'user' and client_message_id is not null;

alter table public.assistant_messages enable row level security;
revoke all on public.assistant_messages from anon;
revoke insert, update, delete on public.assistant_messages from authenticated;
grant select on public.assistant_messages to authenticated;
grant all on public.assistant_messages to service_role;

create policy assistant_messages_select_own on public.assistant_messages
  for select to authenticated using (user_id = (select auth.uid()));

-- -------------------------------------------------------- assistant_jobs
-- Work for the relay, one queue per environment. A chat job points at the
-- user message it answers; a check-in job (NH-66) has no message and uses
-- dedup_key (e.g. 'checkin:2026-10-01') so the daily cron can't queue it
-- twice.
--
-- Lifecycle: pending → leased (by assistant_claim_jobs) → done, or back to
-- pending on a failed attempt, or failed after max_attempts. A lease that
-- expires without an ack is claimable again; that counts as an attempt.
create table public.assistant_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  environment text not null check (environment in ('dev', 'prod')),
  kind text not null check (kind in ('chat', 'checkin')),
  message_id uuid unique references public.assistant_messages (id) on delete cascade,
  dedup_key text check (char_length(dedup_key) between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'leased', 'done', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  lease_token uuid,
  leased_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'chat') = (message_id is not null)),
  check ((status = 'leased') = (lease_token is not null and leased_until is not null)),
  unique (user_id, dedup_key)
);

create index assistant_jobs_queue_idx
  on public.assistant_jobs (environment, created_at, id)
  where status in ('pending', 'leased');

create index assistant_jobs_user_active_idx
  on public.assistant_jobs (user_id)
  where status in ('pending', 'leased');

alter table public.assistant_jobs enable row level security;
revoke all on public.assistant_jobs from anon, authenticated;
grant all on public.assistant_jobs to service_role;

-- Leases up to p_limit jobs for one environment, oldest first. At most one
-- job per user is ever in flight, so a user's messages are answered in order
-- and their sandbox never gets two turns at once (D-29's
-- max_concurrent_runs: 1). Expired leases are reclaimed; a job whose
-- expired lease already used its last attempt is marked failed instead.
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
    select distinct on (j.user_id) j.id, j.created_at
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

-- Finishes a leased job. Returns false when the lease is no longer held
-- (expired and reclaimed, or already acked), so a late relay can't clobber
-- a newer attempt. A failure goes back to pending until max_attempts.
create or replace function public.assistant_ack_job(
  p_job_id bigint,
  p_lease_token uuid,
  p_ok boolean,
  p_error text default null
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
  set status = case
        when p_ok then 'done'
        when attempts >= max_attempts then 'failed'
        else 'pending'
      end,
      lease_token = null,
      leased_until = null,
      last_error = case when p_ok then null else left(p_error, 2000) end,
      updated_at = now()
  where id = p_job_id
    and status = 'leased'
    and lease_token = p_lease_token
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

revoke execute on function public.assistant_claim_jobs(text, int, int) from public, anon, authenticated;
revoke execute on function public.assistant_ack_job(bigint, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.assistant_claim_jobs(text, int, int) to service_role;
grant execute on function public.assistant_ack_job(bigint, uuid, boolean, text) to service_role;

-- ------------------------------------------------ flag descriptions (v1.2)
-- The runtime changed from NanoClaw to OpenShell + Hermes (D-25); keep the
-- flag descriptions in step.
update public.feature_flags set description = 'Coach chat outside workouts on a per-user Hermes agent (Stage A)'
where flag = 'assistant_chat';
update public.feature_flags set description = 'In-workout coaching on the Hermes runtime (Stage B, post-hackathon)'
where flag = 'assistant_workout';
