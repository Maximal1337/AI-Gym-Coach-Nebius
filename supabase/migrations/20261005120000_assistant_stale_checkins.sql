-- A check-in is never sent a day late (NH-66, docs/assistant-ops.md).
--
-- assistant_enqueue_checkins fails yesterday's check-ins only when the 06:00
-- UTC cron queues today's, and only those still pending. Nothing else looked
-- at a check-in's day, so one held back by the spend ceiling or a relay
-- outage was claimed right after UTC midnight — as the user's oldest job,
-- ahead of anything newer — and pushed at night, with the new day's
-- check-in following at 06:00. One leased during the 06:00 sweep and handed
-- back since (deferred, or a failed attempt) went out late as well.
--
-- The claim now fails a check-in from an earlier day before it hands anything
-- out. Same function otherwise; CREATE OR REPLACE keeps its service_role-only
-- grants.

create or replace function public.assistant_claim_jobs(
  p_environment text,
  p_limit int,
  p_lease_seconds int
)
returns setof public.assistant_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_environment not in ('dev', 'prod') then
    raise exception 'unknown environment %', p_environment using errcode = '22023';
  end if;
  if p_limit not between 1 and 100 or p_lease_seconds not between 10 and 3600 then
    raise exception 'limit or lease out of range' using errcode = '22023';
  end if;

  update public.assistant_jobs
  set status = 'failed',
      lease_token = null,
      leased_until = null,
      last_error = coalesce(last_error, 'lease expired'),
      updated_at = now()
  where environment = p_environment
    and status = 'leased'
    and leased_until <= now()
    and attempts >= max_attempts;

  -- A check-in goes out on its own UTC day or not at all. One from an earlier
  -- day is failed as stale before anything is handed out: held back past
  -- midnight by the spend ceiling or a relay outage, it would otherwise be
  -- the user's oldest job the moment the ceiling resets, and go out in the
  -- night with the new day's check-in still to come. One leased during the
  -- 06:00 sweep (which only fails pending ones) and handed back since is
  -- caught here too. A check-in whose lease is live is being answered: it
  -- finishes.
  update public.assistant_jobs
  set status = 'failed',
      last_error = 'stale: not sent on its day',
      lease_token = null,
      leased_until = null,
      updated_at = now()
  where environment = p_environment
    and kind = 'checkin'
    and (status = 'pending' or (status = 'leased' and leased_until <= now()))
    and dedup_key < 'checkin:' || to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');

  return query
  with candidates as (
    -- Each user's oldest open job, deferred or not: a deferred one holds the
    -- user's place in line rather than letting a later message overtake it.
    select distinct on (j.user_id) j.id, j.created_at, j.not_before
    from public.assistant_jobs j
    where j.environment = p_environment
      and (j.status = 'pending' or (j.status = 'leased' and j.leased_until <= now()))
      and not exists (
        select 1
        from public.assistant_jobs l
        where l.user_id = j.user_id
          and l.status = 'leased'
          and l.leased_until > now()
      )
    order by j.user_id, j.created_at, j.id
  ),
  picked as (
    select j.id
    from public.assistant_jobs j
    join candidates c on c.id = j.id
    where c.not_before is null or c.not_before <= now()
    order by c.created_at, j.id
    limit p_limit
    for update of j skip locked
  ),
  leased as (
    update public.assistant_jobs j
    set status = 'leased',
        attempts = j.attempts + 1,
        lease_token = gen_random_uuid(),
        leased_until = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    from picked
    where j.id = picked.id
    returning j.*
  )
  select * from leased order by created_at, id;
end;
$$;
