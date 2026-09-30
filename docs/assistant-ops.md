# Coach chat — operations

Kill switch and saved queries for the hackathon's coach chat (NH-57 in [`nebius-hackathon-plan.md`](./nebius-hackathon-plan.md)). Spend and credits have their own [budget runbook](./budget-runbook.md). Run everything in the Supabase SQL editor; days are UTC.

## Kill switch

Hides the assistant for everyone at once — the app, `assistant-send` and `notch-tools` all check the same flags. Per-user flags stay as they are:

```sql
update public.feature_flags set enabled = false where flag like 'assistant_%';
```

Back on — every assistant flag except Stage B's `assistant_workout`, which stays off:

```sql
update public.feature_flags set enabled = true where flag like 'assistant_%' and flag <> 'assistant_workout';
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

## Queue right now

What the relay has to do, per environment (NH-35: the VPS's health check can't see this, it lives here). `waiting_for_room` are jobs handed back because every sandbox slot was busy or the user's sandbox was starting (NH-55); their `last_error` says why:

```sql
select environment,
       count(*) filter (where status = 'pending' and (not_before is null or not_before <= now())) as ready,
       count(*) filter (where status = 'pending' and not_before > now()) as waiting_for_room,
       count(*) filter (where status = 'leased') as running,
       max(now() - created_at) filter (where status = 'pending') as oldest_pending,
       string_agg(distinct last_error, ', ') filter (where status = 'pending' and not_before > now()) as why_waiting
from public.assistant_jobs
where status in ('pending', 'leased')
group by 1;
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

## Nightly memory job

`memory-nightly` (NH-63) turns each flagged user's new messages into scored facts. Supabase Cron calls it every 10 minutes between 00:00 and 02:59 UTC; each call works through the users due today until its time budget runs out.

**Setup, once:** deploy the function with `--no-verify-jwt`, set `MEMORY_CRON_SECRET`, `MEMORY_TOKEN_FACTORY_API_KEY` (member B's key) and `MEMORY_MODEL`, then follow [`supabase/cron/assistant.sql`](../supabase/cron/assistant.sql) in the SQL editor.

**Run it now** — for example, right after re-seeding a demo account, so its facts are built from the seeded history:

```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/memory-nightly" \
  -H "x-cron-secret: <MEMORY_CRON_SECRET>"
```

A user already processed today is skipped until tomorrow. To force another run for one account:

```sql
update public.user_memory_state set last_run_at = null where user_id = '<uuid>';
```

**Per-user state and the last error:**

```sql
select u.email, s.last_run_at, s.watermark, s.facts_version, s.last_error,
       (select count(*) from public.user_facts f where f.user_id = s.user_id) as facts
from public.user_memory_state s
join auth.users u on u.id = s.user_id
order by s.last_run_at desc nulls last;
```

**Recent cron calls** (Supabase's `cron` schema; the function logs a `memory_run` summary with its duration for each call):

```sql
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d
join cron.job j using (jobid)
order by d.start_time desc
limit 20;
```

## Daily check-in

At 06:00 UTC Supabase Cron queues one check-in per user with both `assistant_chat` and `assistant_checkin` ([`supabase/cron/assistant.sql`](../supabase/cron/assistant.sql)). The relay runs it in the user's sandbox; when there's nothing worth saying the agent answers `SKIP` and nothing is sent. A check-in that didn't go out on its day is marked stale the next morning rather than sent late.

Opt an account in:

```sql
insert into public.user_flags (user_id, flag) values ('<uuid>', 'assistant_checkin');
```

Queue today's check-ins now, e.g. for a demo — safe to repeat, it never queues the same day twice:

```sql
select public.assistant_enqueue_checkins();
```
