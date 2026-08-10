-- Phase 2 monetization, amended: a time-boxed first-month-free trial
-- instead of the workout-count allowance the "Subscription Pricing &
-- Monetization Strategy" doc originally proposed (usage_ledger stays in
-- place as an abuse-cap only — see budgetRemaining() in
-- supabase/functions/_shared/mod.ts). subscription_status/
-- subscription_expires_at are kept in sync by the revenuecat-webhook
-- function, never written by clients (no client grant added below).
alter table public.users
  add column trial_ends_at timestamptz not null default (now() + interval '30 days'),
  add column subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing', 'active', 'canceled', 'expired')),
  add column subscription_expires_at timestamptz,
  add column revenuecat_customer_id text unique;

-- Existing rows never had a trial clock running — back-date from actual
-- signup instead of leaving everyone's default at "now + 30d", so an
-- account created weeks ago doesn't get a fresh full month for free.
update public.users set trial_ends_at = created_at + interval '30 days';

create index users_revenuecat_customer_id_idx
  on public.users (revenuecat_customer_id) where revenuecat_customer_id is not null;
