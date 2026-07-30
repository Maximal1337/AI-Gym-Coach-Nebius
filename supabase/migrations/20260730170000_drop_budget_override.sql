-- Revert of 20260730160000_budget_override.sql: a per-user cap override
-- was rejected in favor of just resetting usage — every account,
-- including the developer's, should stay on the same budget.
alter table public.users
  drop column budget_override_cents;
