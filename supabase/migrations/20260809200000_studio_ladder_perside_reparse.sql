-- Studio addendum: per-side reps ("6/6 pistol" is ONE value done each side,
-- not two scaling tiers), rep ladders ("10-8-6-3-3 Deadlift" — one value per
-- round), and natural-language re-parse ("Did I get something wrong?").

-- ---------------------------------------------------------- studio_exercises
-- per_side/extra_per_side mirror unit/extra_unit's primary+extra split.
-- ladder is primary-metric only (a laddered exercise pairing a second unit
-- with its own separate ladder isn't a real board pattern worth the schema
-- weight) — when set, `value` is a fallback (the first round), and the UI
-- reads `ladder` instead of `value` wherever it's present.
alter table public.studio_exercises
  add column per_side boolean not null default false,
  add column extra_per_side boolean not null default false,
  add column ladder numeric[];

-- --------------------------------------------------------- studio_sessions
-- The original photo/text/file the session was parsed from — needed so
-- "Did I get something wrong?" can re-send the SAME source alongside the
-- user's correction, rather than trying to patch fields for a mistake that
-- was structural (a ladder read as one set, a per-side value read as two
-- tiers). Transient by design: populated only while the session is open,
-- and the studio-session Edge Function nulls it out the moment the session
-- is saved or discarded — a saved session's row never carries the photo,
-- consistent with the original "discard the photo after parsing" decision;
-- this only widens "after parsing" to "after parsing AND the session closes".
alter table public.studio_sessions
  add column source_payload jsonb;
