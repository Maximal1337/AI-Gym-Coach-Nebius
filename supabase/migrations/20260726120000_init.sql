-- GymCoach AI — initial schema (GYM-6) + row-level security (GYM-7).
--
-- Access model ("one choke point"): clients get row-scoped SELECT on their
-- own data, plus writes only to their own profile/persona. Every other
-- mutation (plan parsing, session lifecycle, set logging, notes, usage
-- accounting) goes through Edge Functions running as service_role, which
-- bypasses RLS. This structurally enforces "no in-place plan editing" and
-- keeps the usage ledger tamper-proof from the client.

-- ---------------------------------------------------------------- users
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  apple_sub text unique,
  locale text not null default 'he',
  terms_accepted_at timestamptz,
  terms_version text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------- coach_profiles
create table public.coach_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  coach_name text not null,
  language text not null default 'he',
  tone_preset text not null check (
    tone_preset in ('motivational_energetic', 'calm_precise', 'tough_love', 'friendly_casual')
  ),
  accountability_style text not null check (
    accountability_style in ('gentle', 'no_excuses')
  ),
  persona_freeform text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------- training_plans
-- One row per workout-type ("Workout A", "Workout B", ...). A user has
-- SEVERAL active rows at once — one per workout-type in the current
-- program. Pasting a new program archives all prior rows; there is
-- deliberately no unique-active constraint here.
create table public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create index training_plans_user_active_idx
  on public.training_plans (user_id) where status = 'active';

-- ------------------------------------------------------------ exercises
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans (id) on delete cascade,
  order_index int not null,
  name text not null,
  sets int not null check (sets between 1 and 20),
  rep_range text not null,
  rest_sec int not null check (rest_sec between 0 and 1800),
  intensity text not null,
  warmup text,
  unique (plan_id, order_index)
);

-- ----------------------------------------------------- workout_sessions
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  plan_id uuid not null references public.training_plans (id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress' check (
    status in ('in_progress', 'completed', 'abandoned')
  ),
  source text not null default 'live' check (source in ('live', 'imported'))
);

create index workout_sessions_user_started_idx
  on public.workout_sessions (user_id, started_at desc);

-- ------------------------------------------------------------- set_logs
create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  set_no int not null check (set_no between 1 and 20),
  weight_kg numeric(6, 2) not null check (weight_kg >= 0),
  reps int not null check (reps between 0 and 200),
  note text,
  created_at timestamptz not null default now(),
  -- Idempotency substrate for offline-sync retries (GYM-17): the write
  -- path must INSERT ... ON CONFLICT DO NOTHING so a replayed confirmed
  -- set is a silent no-op, never a duplicate row.
  unique (session_id, exercise_id, set_no)
);

create index set_logs_exercise_created_idx
  on public.set_logs (exercise_id, created_at desc);

-- ---------------------------------------------------------- coach_notes
create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create index coach_notes_user_exercise_idx
  on public.coach_notes (user_id, exercise_id);

-- --------------------------------------------------------- usage_ledger
-- One row per user per calendar month. The "12 workouts" the user sees is
-- an approximation derived from this; the ledger itself is the mechanism.
create table public.usage_ledger (
  user_id uuid not null references public.users (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  tokens_input bigint not null default 0 check (tokens_input >= 0),
  tokens_output bigint not null default 0 check (tokens_output >= 0),
  cost_cents numeric(10, 4) not null default 0 check (cost_cents >= 0),
  primary key (user_id, period)
);

-- ------------------------------------------------------------------ RLS
alter table public.users enable row level security;
alter table public.coach_profiles enable row level security;
alter table public.training_plans enable row level security;
alter table public.exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.set_logs enable row level security;
alter table public.coach_notes enable row level security;
alter table public.usage_ledger enable row level security;

-- Anonymous clients have no business here at all.
revoke all on all tables in schema public from anon;

-- users: read + bootstrap + locale-only self-update.
-- RLS scopes rows; column-level grants scope columns. Clients may create
-- their own row (id + locale) and later change locale — nothing else.
-- terms_accepted_at / terms_version / apple_sub are written exclusively by
-- Edge Functions (service_role), so the consent audit trail can never be
-- forged or edited from a client.
create policy users_select_own on public.users
  for select to authenticated using (id = (select auth.uid()));
create policy users_insert_own on public.users
  for insert to authenticated with check (id = (select auth.uid()));
create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke insert, update on public.users from authenticated;
grant insert (id, locale) on public.users to authenticated;
grant update (locale) on public.users to authenticated;

-- coach_profiles: the one fully user-editable table (persona config).
-- The non-negotiable safety layer is injected server-side and never lives here.
create policy coach_profiles_select_own on public.coach_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy coach_profiles_insert_own on public.coach_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy coach_profiles_update_own on public.coach_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy coach_profiles_delete_own on public.coach_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

-- Everything below is read-only for clients; mutations go through
-- Edge Functions (service_role bypasses RLS).
create policy training_plans_select_own on public.training_plans
  for select to authenticated using (user_id = (select auth.uid()));

create policy exercises_select_own on public.exercises
  for select to authenticated using (
    exists (
      select 1 from public.training_plans p
      where p.id = plan_id and p.user_id = (select auth.uid())
    )
  );

create policy workout_sessions_select_own on public.workout_sessions
  for select to authenticated using (user_id = (select auth.uid()));

create policy set_logs_select_own on public.set_logs
  for select to authenticated using (
    exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

create policy coach_notes_select_own on public.coach_notes
  for select to authenticated using (user_id = (select auth.uid()));

create policy usage_ledger_select_own on public.usage_ledger
  for select to authenticated using (user_id = (select auth.uid()));
