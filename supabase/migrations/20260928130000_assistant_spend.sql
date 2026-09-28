-- Token Factory spend for the hackathon features, per UTC day and bucket
-- (NH-38, D-34 in docs/nebius-hackathon-plan.md).
--
-- Buckets follow the credit split (D-24): 'prod' and 'dev' are the agent's
-- two Token Factory keys on member A's account, 'memory' is the nightly job
-- on member B's. The ceilings themselves live in _shared/assistant.ts
-- (spendCeilingsCents), read from secrets; this table is only the running
-- total they are checked against.
--
-- Deliberately separate from usage_ledger: that ledger backs the live
-- coach's per-user monthly budget (mod.ts budgetRemaining), and assistant
-- spend must not change how the live coach behaves for anyone (D-17).
create table public.assistant_spend (
  day date not null,
  bucket text not null check (bucket in ('prod', 'dev', 'memory')),
  calls int not null default 0 check (calls >= 0),
  tokens_input bigint not null default 0 check (tokens_input >= 0),
  tokens_output bigint not null default 0 check (tokens_output >= 0),
  cost_cents numeric(12, 6) not null default 0 check (cost_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, bucket)
);

alter table public.assistant_spend enable row level security;
revoke all on public.assistant_spend from anon, authenticated;
grant all on public.assistant_spend to service_role;

-- Adds one model call to today's (UTC) total and returns the new total in
-- cents. Atomic upsert-increment, like record_usage.
create or replace function public.assistant_record_spend(
  p_bucket text,
  p_tokens_input bigint,
  p_tokens_output bigint,
  p_cost_cents numeric
)
returns numeric
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  if p_tokens_input < 0 or p_tokens_output < 0 or p_cost_cents < 0 then
    raise exception 'spend must not be negative' using errcode = '22023';
  end if;
  insert into public.assistant_spend as s (day, bucket, calls, tokens_input, tokens_output, cost_cents)
  values ((now() at time zone 'utc')::date, p_bucket, 1, p_tokens_input, p_tokens_output, p_cost_cents)
  on conflict (day, bucket) do update
    set calls = s.calls + 1,
        tokens_input = s.tokens_input + excluded.tokens_input,
        tokens_output = s.tokens_output + excluded.tokens_output,
        cost_cents = s.cost_cents + excluded.cost_cents,
        updated_at = now()
  returning s.cost_cents into v_total;
  return v_total;
end;
$$;

-- Today's (UTC) total in cents for a bucket; 0 when nothing was spent yet.
create or replace function public.assistant_spend_today(p_bucket text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select cost_cents from public.assistant_spend
     where day = (now() at time zone 'utc')::date and bucket = p_bucket),
    0
  );
$$;

revoke execute on function public.assistant_record_spend(text, bigint, bigint, numeric) from public, anon, authenticated;
revoke execute on function public.assistant_spend_today(text) from public, anon, authenticated;
grant execute on function public.assistant_record_spend(text, bigint, bigint, numeric) to service_role;
grant execute on function public.assistant_spend_today(text) to service_role;
