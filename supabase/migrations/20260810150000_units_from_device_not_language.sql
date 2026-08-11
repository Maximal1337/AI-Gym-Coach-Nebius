-- Units were derived purely from app language (en -> imperial, he/ar ->
-- metric) — wrong for the large population of English speakers outside
-- the US (UK, Israel, India, ...), who get lbs/in defaults despite their
-- device's real measurement system being metric. Re-adds a real,
-- per-account units column (a prior version of this had one, dropped in
-- 20260810120000 when the language-derivation "simplification" landed) —
-- this time populated from the device's actual measurement system
-- (expo-localization's `measurementSystem`) at coach_profiles creation
-- time, not guessed from language. See profileToAgent in
-- supabase/functions/_shared/mod.ts for the server-side read, and
-- apps/mobile/src/lib/units.tsx for the client-side read — both need to
-- agree, since the agent's own chat prose and the screen displaying it
-- must always match.
alter table public.coach_profiles
  add column units text not null default 'metric' check (units in ('metric', 'imperial'));
