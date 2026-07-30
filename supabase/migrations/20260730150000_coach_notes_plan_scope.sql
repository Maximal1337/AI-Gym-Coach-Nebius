-- Notes were only scoped to (user_id, exercise_id) — and "general" notes
-- (exercise_id null, e.g. "warm up 10 min before this workout") had no
-- scope at all beyond the user, so they kept applying forever, even to a
-- brand new plan created after the original one was archived. Scoping
-- notes to the plan they were created under fixes that: archiving a plan
-- and starting a new one now leaves old notes behind, same as the old
-- plan's exercises themselves already do.
alter table public.coach_notes
  add column plan_id uuid references public.training_plans (id) on delete cascade;

-- Backfill what's derivable: an exercise-specific note's plan is its
-- exercise's plan. Existing general notes (exercise_id null) have no
-- recoverable plan and are left with plan_id null — they simply stop
-- matching any plan going forward, which is the desired fix.
update public.coach_notes cn
set plan_id = e.plan_id
from public.exercises e
where cn.exercise_id = e.id and cn.plan_id is null;

create index coach_notes_user_plan_idx on public.coach_notes (user_id, plan_id);
