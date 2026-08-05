-- Lets a user skip the "add a workout plan" onboarding step and land in
-- the app with no active plan — app/index.tsx's gate redirects to
-- onboarding-plan whenever plan count is 0, so without a persisted flag
-- the user would just bounce right back there on every app open. This is
-- a plain user preference (not an audit trail like terms_accepted_at),
-- so it's client-writable the same way locale already is.

alter table public.users add column plan_setup_skipped_at timestamptz;

grant update (locale, plan_setup_skipped_at) on public.users to authenticated;
