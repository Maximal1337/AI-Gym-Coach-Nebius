-- Units are now derived from the user's language (apps/mobile/src/lib/units.tsx,
-- supabase/functions/_shared/mod.ts's profileToAgent) rather than a stored
-- per-user preference — the manual kg/lbs picker this column backed has
-- been removed.

alter table public.users
  drop column units;

grant update (locale, plan_setup_skipped_at) on public.users to authenticated;
