-- fitness_profiles becomes directly client-writable (own row), same as
-- coach_profiles — self-reported personal data with no real invariants
-- beyond the CHECK constraints already on the table, so there's no reason
-- to route every edit through an Edge Function. This is in addition to,
-- not instead of, the upsert plan-generate already does server-side: the
-- "about you" step now saves as soon as the user moves past it (goal/
-- experience/days are already chosen by then), independent of whether
-- generation ever runs, and Settings can edit gender/age/weight/height
-- afterward without re-running the whole intake.
create policy fitness_profiles_insert_own on public.fitness_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy fitness_profiles_update_own on public.fitness_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy fitness_profiles_delete_own on public.fitness_profiles
  for delete to authenticated using (user_id = (select auth.uid()));
