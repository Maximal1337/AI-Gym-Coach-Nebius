-- A deferral has a limit (NH-55).
--
-- A deferral handed the job back with no limit, its attempt refunded each
-- time: a sandbox stuck in a busy phase (an image that won't pull, a pod that
-- won't schedule) kept the user's oldest job pending forever, every later
-- message held behind it, and the app never showed a failure. A job deferred
-- once it's 30 minutes old now fails instead, with last_error "deferred too
-- long: <reason>": long enough for a morning backlog at D-31's capacity, short
-- enough that a stuck sandbox doesn't hold a user's messages for hours. The
-- app then offers to send it again.
--
-- Same function otherwise; CREATE OR REPLACE keeps its service_role-only grants.

create or replace function public.assistant_defer_job(
  p_environment text,
  p_job_id bigint,
  p_lease_token uuid,
  p_seconds int,
  p_reason text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update public.assistant_jobs
  set status = case when created_at < now() - interval '30 minutes' then 'failed' else 'pending' end,
      attempts = greatest(attempts - 1, 0),
      lease_token = null,
      leased_until = null,
      not_before = case when created_at < now() - interval '30 minutes' then null
                        else now() + make_interval(secs => least(greatest(coalesce(p_seconds, 30), 1), 3600)) end,
      last_error = case when created_at < now() - interval '30 minutes'
                        then left('deferred too long: ' || coalesce(p_reason, 'no reason given'), 200)
                        else left(p_reason, 200) end,
      updated_at = now()
  where id = p_job_id
    and environment = p_environment
    and status = 'leased'
    and lease_token = p_lease_token
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;
