# Budget check — every Monday

NH-38 and D-34 in [`nebius-hackathon-plan.md`](./nebius-hackathon-plan.md). The rule is no out-of-pocket spend: everything must fit the credits through 2026-12-15. Takes about ten minutes.

| Account | AI Cloud | Token Factory |
|---|---|---|
| Member A — @Maximal1337 | $100: the VPS until 2026-11-14 | $150: the agent's `prod` and `dev` keys |
| Member B — @dorhaimbob-web | $100: the VPS from 2026-11-15 | $150: the nightly memory job's key |

## 1. Read the balances

For each account in the Nebius console, note:
- the remaining AI Cloud and Token Factory credit, and when it expires;
- the VPS preset and hourly price (2 vCPU / 8 GiB is $0.0496/h, 4 vCPU / 16 GiB is $0.0992/h, plus about $0.14/day for the 60 GiB disk).

The Nebius console is the source of truth. `public.assistant_spend` only counts calls made through our code (the relay and the memory job), not manual tests against a key.

## 2. Forecast Token Factory spend

In the Supabase SQL editor:

```sql
with last7 as (
  select bucket, sum(cost_cents) / 7 as cents_per_day
  from public.assistant_spend
  where day > (now() at time zone 'utc')::date - 7
  group by bucket
)
select bucket,
       round(cents_per_day / 100, 2) as usd_per_day,
       round(cents_per_day * ('2026-12-15'::date - (now() at time zone 'utc')::date) / 100, 2) as usd_until_dec_15
from last7
order by bucket;
```

- **Member A:** `prod` + `dev` "until Dec 15" must stay under 90% of member A's remaining Token Factory credit.
- **Member B:** `memory` must stay under 90% of member B's.

Day-by-day detail:

```sql
select day, bucket, calls, tokens_input, tokens_output, round(cost_cents, 2) as cents
from public.assistant_spend
where day > (now() at time zone 'utc')::date - 14
order by day desc, bucket;
```

## 3. Forecast AI Cloud spend

Hourly price × hours left on that account's period (§7 of the plan), plus the disk. It must stay under 90% of the remaining AI Cloud credit. The optional 4 vCPU / 16 GiB upsize in October happens only if this still holds after adding it.

## 4. If a forecast is over 90%

In this order, re-checking the forecast after each step:

1. **Turn dev off.** Its Token Factory ceiling takes effect for new requests, with no redeploy:

   ```bash
   supabase secrets set ASSISTANT_SPEND_CEILING_CENTS_DEV=0
   ```

   On AI Cloud, remove the `notch-dev` application from the Argo CD app-of-apps in Git; Argo CD prunes it and frees its memory.
2. **Lower the ceilings.** For example:

   ```bash
   supabase secrets set ASSISTANT_SPEND_CEILING_CENTS_PROD=60
   supabase secrets set ASSISTANT_SPEND_CEILING_CENTS_MEMORY=30
   ```
3. **Cancel or shorten the optional 4 vCPU / 16 GiB periods** (D-31).
4. **Ask in the [Nebius Discord](https://discord.gg/eXYTGhgnhK)** for extra credits (O-10).

Record the numbers and any action in the week's Linear cycle.
