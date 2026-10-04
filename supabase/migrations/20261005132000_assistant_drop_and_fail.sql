-- Ending a job that mustn't run, and failing one per environment (NH-52, NH-57).
--
-- assistant_drop_job ends a leased job for good, whatever its attempts.
-- assistant-outbox uses it as it claims work that must not run at all: the
-- user's assistant flags are off (the kill switch, or a flag removed after the
-- job was queued), or a check-in for a user without a subscription. Before,
-- only enqueueing checked flags, so queued work still ran and pushed after the
-- kill switch, and check-ins skipped the paywall assistant-send enforces.
--
-- assistant_fail_job is assistant_ack_job's failure, scoped to the
-- environment that signed the request, as defer and complete already are. A
-- lease token is unguessable, so this is defence in depth.

-- Ends a leased job for good: failed, whatever its attempts, with the reason.
-- False when the lease isn't this caller's (or the job isn't this
-- environment's).
create or replace function public.assistant_drop_job(
  p_environment text,
  p_job_id bigint,
  p_lease_token uuid,
  p_reason text
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
  set status = 'failed',
      lease_token = null,
      leased_until = null,
      not_before = null,
      last_error = left(p_reason, 200),
      updated_at = now()
  where id = p_job_id
    and environment = p_environment
    and status = 'leased'
    and lease_token = p_lease_token
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

-- A failed attempt, as assistant_ack_job(p_ok => false), for the environment
-- that signed the request only.
create or replace function public.assistant_fail_job(
  p_environment text,
  p_job_id bigint,
  p_lease_token uuid,
  p_error text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.assistant_jobs where id = p_job_id and environment = p_environment) then
    return false;
  end if;
  return public.assistant_ack_job(p_job_id, p_lease_token, false, p_error);
end;
$$;

revoke execute on function public.assistant_drop_job(text, bigint, uuid, text) from public, anon, authenticated;
revoke execute on function public.assistant_fail_job(text, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.assistant_drop_job(text, bigint, uuid, text) to service_role;
grant execute on function public.assistant_fail_job(text, bigint, uuid, text) to service_role;
