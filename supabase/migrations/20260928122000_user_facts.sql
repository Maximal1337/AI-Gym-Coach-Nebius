-- Personalization memory (NH-60, D-11 and D-30 in docs/nebius-hackathon-plan.md).
--
-- The canonical, user-visible memory: up to 15 short typed facts per user,
-- distilled from chats by the nightly job (NH-63). The score is computed in
-- code (_shared/memory-scoring.ts, NH-62), never by the LLM, and the job
-- applies that module's plan: removals first, then inserts, then score
-- updates — the caps below are a safety net that makes a wrong order fail
-- loudly instead of silently exceeding them.
--
-- doc is a JSONB document (D-12). The check below pins the fields the
-- scoring module depends on; the rest (expires_at, first_seen_at,
-- last_seen_at, mention_count, source_message_ids) is validated by the job.
--
-- Clients can read and delete their own facts ("What the coach remembers",
-- NH-71); every other write goes through the job on the service_role client.
create table public.user_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- coalesce: a missing key makes the expression NULL, and a CHECK that
  -- evaluates to NULL passes.
  doc jsonb not null check (coalesce(
    jsonb_typeof(doc) = 'object'
    and jsonb_typeof(doc -> 'text') = 'string'
    and char_length(doc ->> 'text') between 1 and 140
    and doc ->> 'category' in ('health', 'goal', 'schedule', 'equipment', 'preference', 'other')
    and jsonb_typeof(doc -> 'importance') = 'number'
    and doc ->> 'importance' in ('1', '2', '3', '4', '5')
    and doc ->> 'stability' in ('temporary', 'long_term', 'permanent')
    and doc ->> 'evidence' in ('explicit', 'inferred'),
    false
  )),
  score numeric(8, 6) not null default 0 check (score >= 0),
  -- Only health/injury facts are ever pinned (max 3 per user).
  pinned boolean not null default false check (not pinned or doc ->> 'category' = 'health'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_facts_user_score_idx on public.user_facts (user_id, score desc);

-- One row per user the memory job has seen. facts_version changes whenever
-- a fact is added, edited, (un)pinned or deleted — including a delete by the
-- user from the app — so anything caching the facts block can tell it's
-- stale. watermark is the created_at up to which messages have been read.
create table public.user_memory_state (
  user_id uuid primary key references public.users (id) on delete cascade,
  facts_version bigint not null default 0 check (facts_version >= 0),
  last_run_at timestamptz,
  watermark timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_facts enable row level security;
alter table public.user_memory_state enable row level security;
revoke all on public.user_facts from anon;
revoke all on public.user_memory_state from anon, authenticated;
revoke insert, update on public.user_facts from authenticated;
grant select, delete on public.user_facts to authenticated;
grant all on public.user_facts to service_role;
grant all on public.user_memory_state to service_role;

create policy user_facts_select_own on public.user_facts
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_facts_delete_own on public.user_facts
  for delete to authenticated using (user_id = (select auth.uid()));

-- Caps: 15 facts and 3 pinned facts per user (NH-62's MAX_FACTS and
-- MAX_PINNED). Inserts come only from the service_role job, so no security
-- definer is needed.
create or replace function public.user_facts_enforce_caps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     and (select count(*) from public.user_facts where user_id = new.user_id) >= 15 then
    raise exception 'user % already has 15 facts; evict before inserting', new.user_id
      using errcode = '23514';
  end if;
  if new.pinned and (tg_op = 'INSERT' or not old.pinned)
     and (select count(*) from public.user_facts
          where user_id = new.user_id and pinned and id <> new.id) >= 3 then
    raise exception 'user % already has 3 pinned facts', new.user_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger user_facts_enforce_caps
  before insert or update of pinned on public.user_facts
  for each row execute function public.user_facts_enforce_caps();

-- Bumps facts_version. Security definer because a user deleting their own
-- fact runs as `authenticated`, which has no access to user_memory_state.
-- A delete only updates an existing state row, never inserts one: when the
-- user themselves is being deleted, the cascade removes user_facts and
-- user_memory_state in the same statement, and an insert here would fail the
-- foreign key and abort the account deletion. A score-only update (the
-- nightly recency refresh) doesn't bump the version.
create or replace function public.user_facts_bump_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.user_memory_state
    set facts_version = facts_version + 1, updated_at = now()
    where user_id = old.user_id;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.doc is not distinct from old.doc and new.pinned = old.pinned then
    return new;
  end if;
  insert into public.user_memory_state (user_id, facts_version)
  values (new.user_id, 1)
  on conflict (user_id) do update
    set facts_version = public.user_memory_state.facts_version + 1,
        updated_at = now();
  return new;
end;
$$;

revoke execute on function public.user_facts_enforce_caps() from public, anon, authenticated;
revoke execute on function public.user_facts_bump_version() from public, anon, authenticated;

create trigger user_facts_bump_version
  after insert or update or delete on public.user_facts
  for each row execute function public.user_facts_bump_version();
