-- Fixes a real ordering bug in §20: an exercise auto-deferred because the
-- user explicitly asked to jump to a DIFFERENT one ("B can be done now"
-- while D was current) was getting starved behind every other untouched
-- exercise in the plan — "next" always finished scanning the entire fresh
-- pool before reconsidering ANY deferred exercise, so a never-touched
-- exercise later in the plan (E) outranked the one just interrupted (D).
--
-- The two kinds of defer need different priority:
--   - "natural" (the normal advance-with-nothing-logged path, e.g. genuine
--     "this one's taken, skip it") — low priority, resurface only once the
--     whole plan is otherwise exhausted, oldest deferred first. Unchanged.
--   - "interrupt" (the CURRENT exercise gets set aside because the user
--     explicitly asked for a DIFFERENT one instead) — high priority,
--     resurface immediately once whatever it was swapped for is done,
--     ahead of both fresh exercises and natural defers. New.
alter table public.session_exercise_skips
  add column interrupted boolean not null default false;
