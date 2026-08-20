-- Server-controlled app-version gate (force-update / update-nudge).
--
-- The threshold lives here, NOT in the client, so it can be changed without
-- an app release — which is the whole safety story: a bad value is fixed by
-- editing one row, no rebuild, no App Review wait.
--
-- GUARDRAIL: min_supported_version must NEVER be set above the version that is
-- actually live on the App Store. Blocking users onto a build that doesn't
-- exist yet strands them with nothing to update to. Only ever raise it to a
-- version that is already downloadable.
--
-- Seeded OFF: min '0.0.0' blocks nobody, latest = current shipping version so
-- no nudge fires until someone deliberately changes these.

create table if not exists public.app_config (
  platform text primary key check (platform in ('ios', 'android')),
  -- Hard gate: running < this -> force update. '0.0.0' = gate disabled.
  min_supported_version text not null default '0.0.0',
  -- Soft nudge: running < this (and >= min) -> dismissible "update available".
  latest_version text,
  -- Where the Update button sends the user. Null until the store listing exists.
  store_url text,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- Public read: even a signed-out client on a dead old version must be able to
-- learn it has to update. No write policy — only the dashboard/service_role
-- (which bypasses RLS) can move the thresholds.
drop policy if exists app_config_select_all on public.app_config;
create policy app_config_select_all on public.app_config
  for select to anon, authenticated using (true);

grant select on public.app_config to anon, authenticated;

insert into public.app_config (platform, min_supported_version, latest_version, store_url)
values ('ios', '0.0.0', '1.0.1', null)
on conflict (platform) do nothing;
