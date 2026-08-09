-- Studio workouts — a second training kind for class/functional-fitness
-- trainees (whiteboard boards: blocks, coach-set scaling tiers, per-movement
-- units) alongside gym training_plans/exercises. Fully additive: no FKs into
-- gym tables, no shared columns, no changes to any existing table. Access
-- model matches the rest of the schema (see 20260726120000_init.sql) —
-- client SELECT scoped to user_id, all writes via the studio-session Edge
-- Function (service_role).

-- -------------------------------------------------------- studio_sessions
-- "Live" is the session, not a screen: a session is created the moment a
-- board is parsed (or a blank one is started) and stays open (saved_at is
-- null) until the user deliberately saves or discards it. There is no
-- auto-save/abandoned state — a session is only ever saved by a deliberate
-- action, so saved_at itself is the whole lifecycle.
create table public.studio_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- "Do one again" copies a prior session's structure; this is lineage only,
  -- never a live reference edits flow through.
  source_session_id uuid references public.studio_sessions (id) on delete set null,
  name text not null,
  started_at timestamptz not null default now(),
  saved_at timestamptz,
  score_type text check (score_type in ('fortime', 'amrap', 'emom', 'strength')),
  score jsonb,
  intensity smallint check (intensity between 1 and 5),
  note text
);

-- One open session per user, enforced here rather than only in the UI —
-- starting a new workout requires closing (save or discard) the last one.
create unique index studio_sessions_one_open_per_user
  on public.studio_sessions (user_id) where saved_at is null;

create index studio_sessions_user_saved_idx
  on public.studio_sessions (user_id, saved_at desc);

-- --------------------------------------------------------- studio_blocks
-- name is nullable: null means "flat list, no header" — a board with no
-- blocks still gets exactly one block row, so exercises never need a
-- nullable block_id or a duplicate format column on the session itself.
create table public.studio_blocks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.studio_sessions (id) on delete cascade,
  order_index int not null,
  name text,
  format_type text not null check (
    format_type in ('buyin', 'rounds', 'fortime', 'amrap', 'emom', 'intervals', 'custom')
  ),
  format_params jsonb not null default '{}'::jsonb,
  format_custom text,
  unique (session_id, order_index)
);

-- ------------------------------------------------------ studio_exercises
-- Metrics are inlined rather than a child table: the UI ceiling is a base
-- metric plus one optional "+ unit" addition (studio-workout-entry.html),
-- and that cardinality never varies — a fixed second slot avoids a join on
-- every render and every "last time" lookup for a shape that's always 1 or 2.
create table public.studio_exercises (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.studio_blocks (id) on delete cascade,
  order_index int not null,
  name text not null,
  parse_confidence text check (parse_confidence in ('low')),
  unit text not null,
  value numeric not null,
  tiers numeric[],
  tier_index int,
  extra_unit text,
  extra_value numeric,
  extra_tiers numeric[],
  extra_tier_index int,
  unique (block_id, order_index)
);

-- "Last time I did this movement" is a plain indexed name lookup, scoped to
-- the user via the block/session join in the Edge Function — no synonym
-- table yet (deferred along with the rest of Progress-tab trend matching).
create index studio_exercises_name_idx on public.studio_exercises (lower(name));

-- ----------------------------------------------------- studio_custom_units
-- Per-trainee, not per-studio — there's no studio/org entity in the app.
create table public.studio_custom_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  key text not null,
  label text not null,
  step numeric not null default 1,
  min numeric not null default 0,
  max numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

-- ------------------------------------------------------------------ RLS
alter table public.studio_sessions enable row level security;
alter table public.studio_blocks enable row level security;
alter table public.studio_exercises enable row level security;
alter table public.studio_custom_units enable row level security;

create policy studio_sessions_select_own on public.studio_sessions
  for select to authenticated using (user_id = (select auth.uid()));

create policy studio_blocks_select_own on public.studio_blocks
  for select to authenticated using (
    exists (
      select 1 from public.studio_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

create policy studio_exercises_select_own on public.studio_exercises
  for select to authenticated using (
    exists (
      select 1 from public.studio_blocks b
      join public.studio_sessions s on s.id = b.session_id
      where b.id = block_id and s.user_id = (select auth.uid())
    )
  );

create policy studio_custom_units_select_own on public.studio_custom_units
  for select to authenticated using (user_id = (select auth.uid()));

-- Everything above is read-only for clients; all writes (open/update/save/
-- discard, and custom-unit creation) go through the studio-session Edge
-- Function running as service_role, matching the rest of the schema.
