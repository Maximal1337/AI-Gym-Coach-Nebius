-- Units preference (guidelines/units-setting.html): kilograms/centimeters
-- vs. pounds/feet-inches. Same client-writable, plain-preference pattern
-- as locale — weight/height are always STORED in metric regardless of
-- this setting; it only governs display and entry conversion.

alter table public.users
  add column units text not null default 'metric' check (units in ('metric', 'imperial'));

grant update (locale, plan_setup_skipped_at, units) on public.users to authenticated;
