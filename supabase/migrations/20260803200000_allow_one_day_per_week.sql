-- 1 day/week is a real, common case (a beginner, someone very time-
-- constrained) that had no good reason to be excluded — the 2-6 range was
-- just an arbitrary first-pass default, not a deliberate product decision.
alter table public.fitness_profiles
  drop constraint fitness_profiles_days_per_week_check;
alter table public.fitness_profiles
  add constraint fitness_profiles_days_per_week_check check (days_per_week between 1 and 6);
