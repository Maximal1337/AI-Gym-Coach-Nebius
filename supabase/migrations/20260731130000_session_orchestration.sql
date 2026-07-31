-- Dynamic session orchestration (System Design §20): the coach can defer an
-- exercise (equipment busy) and revisit it later in the same session, or
-- substitute a different movement entirely — but only when the user asks.
--
-- exercises.source/session_id: a substitution creates a real exercises row
-- (not a throwaway), so progression on it gets tracked normally. plan_id
-- stays NOT NULL — an adhoc exercise still belongs to the plan it stood in
-- for, it's just also tagged with the one session it was created for.
alter table public.exercises
  add column source text not null default 'plan' check (source in ('plan', 'session_adhoc')),
  add column session_id uuid references public.workout_sessions (id) on delete cascade;

-- A plan-sourced exercise must never carry a session_id, and an adhoc one
-- always must — keeps the two kinds structurally distinct, not just by
-- convention.
alter table public.exercises
  add constraint exercises_source_session_id_check check (
    (source = 'plan' and session_id is null) or
    (source = 'session_adhoc' and session_id is not null)
  );

-- session_exercise_skips: exercises deferred this session with nothing
-- logged for them yet — the pool "next exercise" falls back to once
-- nothing fresh is left. One row per (session, exercise); upserted, not
-- reinserted, so a retried /coach-turn can't double-defer the same
-- exercise (GYM-orchestration idempotency, same substrate as set_logs'
-- own onConflict key above).
create table public.session_exercise_skips (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (session_id, exercise_id)
);

create index session_exercise_skips_session_created_idx
  on public.session_exercise_skips (session_id, created_at);

alter table public.session_exercise_skips enable row level security;

create policy session_exercise_skips_select_own on public.session_exercise_skips
  for select to authenticated using (
    exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );
