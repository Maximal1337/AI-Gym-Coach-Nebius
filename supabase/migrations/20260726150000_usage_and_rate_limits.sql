-- M1: rate limiting substrate (GYM-54) + atomic usage recording (GYM-21).
-- Both are service_role-only: RLS is enabled with no policies, and execute
-- on the functions is revoked from client roles.

create table public.rate_limits (
  user_id uuid not null references public.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Fixed-window counter: returns the count after increment; the caller
-- compares against its limit. Old windows are dead rows cleaned lazily.
create or replace function public.bump_rate(
  p_user_id uuid,
  p_bucket text,
  p_window_start timestamptz
) returns int
language sql
set search_path = public
as $$
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, p_window_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set count = public.rate_limits.count + 1
  returning count;
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default; revoking
-- only from anon/authenticated leaves that inherited grant in place, so a
-- client could still call these via PostgREST RPC with a victim's uuid.
revoke execute on function public.bump_rate from public, anon, authenticated;

-- Atomic per-month usage accumulation (upsert-increment).
create or replace function public.record_usage(
  p_user_id uuid,
  p_period text,
  p_tokens_input bigint,
  p_tokens_output bigint,
  p_cost_cents numeric
) returns void
language sql
set search_path = public
as $$
  insert into public.usage_ledger (user_id, period, tokens_input, tokens_output, cost_cents)
  values (p_user_id, p_period, p_tokens_input, p_tokens_output, p_cost_cents)
  on conflict (user_id, period)
  do update set
    tokens_input = public.usage_ledger.tokens_input + excluded.tokens_input,
    tokens_output = public.usage_ledger.tokens_output + excluded.tokens_output,
    cost_cents = public.usage_ledger.cost_cents + excluded.cost_cents;
$$;

revoke execute on function public.record_usage from public, anon, authenticated;
