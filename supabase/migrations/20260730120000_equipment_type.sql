-- Equipment-aware progression: different equipment jumps by different real
-- weight increments (barbell plates vs. dumbbell pairs vs. machine stacks),
-- so the deterministic progression rules (services/agent/src/progression.ts)
-- can suggest a jump the gym can actually give the user. Nullable — an
-- unrecognized/unset exercise falls back to the existing flat default.
alter table public.exercises
  add column equipment_type text
  check (equipment_type in ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'));
