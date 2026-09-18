-- Server-controlled feature flags (NH-10). The hackathon features (the
-- NanoClaw coach chat, personalization memory, in-workout coaching on
-- NanoClaw) stay visible only to team/demo/judge accounts until a deliberate
-- rollout — real users keep the current experience (D-07 in
-- docs/nebius-hackathon-plan.md).
--
-- A flag is effective for a user only when BOTH its global switch
-- (feature_flags.enabled) and that user's own row (user_flags.enabled) are
-- on. The global switch doubles as the kill switch — it hides a feature for
-- everyone at once, without touching per-user rows:
--   update public.feature_flags set enabled = false where flag like 'assistant_%';
--
-- Clients read their own effective flags through my_feature_flags() and can
-- never write; rows are managed out of band (SQL editor or
-- `supabase db query`), e.g.:
--   insert into public.user_flags (user_id, flag) values ('<uuid>', 'assistant_chat');
-- user_id references auth.users rather than public.users so a flag survives
-- the dev "fresh" scenario, which deletes the public.users row on every login.

create table public.feature_flags (
  flag text primary key check (flag ~ '^[a-z][a-z0-9_]*$'),
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

create table public.user_flags (
  user_id uuid not null references auth.users (id) on delete cascade,
  flag text not null references public.feature_flags (flag) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, flag)
);

-- No client access to the tables themselves: reads go through the functions
-- below, writes happen out of band.
alter table public.feature_flags enable row level security;
alter table public.user_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;
revoke all on public.user_flags from anon, authenticated;
grant all on public.feature_flags to service_role;
grant all on public.user_flags to service_role;

insert into public.feature_flags (flag, enabled, description) values
  ('assistant_chat', true, 'NanoClaw coach chat outside workouts (Stage A)'),
  ('assistant_memory', true, 'Personalization memory: user facts and the "What the coach remembers" screen'),
  ('assistant_workout', false, 'In-workout coaching on NanoClaw (Stage B, stretch)')
on conflict (flag) do nothing;

-- Server-side check, used by _shared/assistant.ts isFlagEnabled(). Security
-- definer with explicit grants — see the postgrest-security-definer-writes
-- skill for why a plain table read through the service-role client isn't
-- relied on here. Safe for any authenticated caller: it only reveals whether
-- a flag is on for a given user id.
create or replace function public.feature_enabled(p_user_id uuid, p_flag text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select f.enabled and u.enabled
    from public.feature_flags f
    join public.user_flags u on u.flag = f.flag
    where f.flag = p_flag and u.user_id = p_user_id
  ), false);
$$;

-- Client read: the calling user's own effective flags.
create or replace function public.my_feature_flags()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(u.flag order by u.flag), '{}')
  from public.user_flags u
  join public.feature_flags f on f.flag = u.flag
  where u.user_id = (select auth.uid()) and u.enabled and f.enabled;
$$;

revoke execute on function public.feature_enabled(uuid, text) from public, anon;
revoke execute on function public.my_feature_flags() from public, anon;
grant execute on function public.feature_enabled(uuid, text) to authenticated, service_role;
grant execute on function public.my_feature_flags() to authenticated, service_role;
