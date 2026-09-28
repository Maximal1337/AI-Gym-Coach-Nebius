# Coach chat — operations

Kill switch and saved queries for the hackathon's coach chat (NH-57 in [`nebius-hackathon-plan.md`](./nebius-hackathon-plan.md)). Spend and credits have their own [budget runbook](./budget-runbook.md). Run everything in the Supabase SQL editor; days are UTC.

## Kill switch

Hides the assistant for everyone at once — the app, `assistant-send` and `notch-tools` all check the same flags. Per-user flags stay as they are:

```sql
update public.feature_flags set enabled = false where flag like 'assistant_%';
```

Back on (Stage B's `assistant_workout` stays off):

```sql
update public.feature_flags set enabled = true where flag in ('assistant_chat', 'assistant_memory');
```

To stop one environment's model spend without hiding anything, set its ceiling to 0 instead:

```bash
supabase secrets set ASSISTANT_SPEND_CEILING_CENTS_DEV=0
```

## Messages per day

```sql
select date_trunc('day', m.created_at at time zone 'utc')::date as day,
       coalesce(a.environment, 'prod') as environment,
       count(*) filter (where m.role = 'user') as from_users,
       count(*) filter (where m.role = 'assistant') as replies,
       count(distinct m.user_id) as users
from public.assistant_messages m
left join public.assistant_agents a on a.user_id = m.user_id
where m.created_at > now() - interval '14 days'
group by 1, 2
order by 1 desc, 2;
```

## Tokens and spend per day

```sql
select day, bucket, calls, tokens_input, tokens_output, round(cost_cents / 100, 2) as usd
from public.assistant_spend
where day > (now() at time zone 'utc')::date - 14
order by day desc, bucket;
```

## Failures per day

Jobs that ran out of attempts, with their last error:

```sql
select date_trunc('day', updated_at at time zone 'utc')::date as day, environment, kind,
       count(*) as failed, max(last_error) as an_error
from public.assistant_jobs
where status = 'failed' and updated_at > now() - interval '14 days'
group by 1, 2, 3
order by 1 desc;
```

## Stuck work

Pending jobs older than 5 minutes (the relay isn't pulling, or the environment is at its spend ceiling), and leases held past their expiry:

```sql
select environment, status, count(*) as jobs, min(created_at) as oldest
from public.assistant_jobs
where (status = 'pending' and created_at < now() - interval '5 minutes')
   or (status = 'leased' and leased_until < now())
group by 1, 2;
```
