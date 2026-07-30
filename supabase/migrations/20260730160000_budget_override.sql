-- Per-user override of the monthly LLM-cost budget (System Design §7,
-- GYM-21). The global USAGE_MONTHLY_BUDGET_CENTS env var stays the
-- default for everyone; this column lets a specific account (e.g. the
-- developer's own, for testing) run past it without raising the cap
-- for real testers.
alter table public.users
  add column budget_override_cents integer check (budget_override_cents >= 0);
