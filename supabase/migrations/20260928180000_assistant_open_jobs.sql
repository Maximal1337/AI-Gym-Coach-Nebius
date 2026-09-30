-- Reply status for the coach chat screen (NH-70 in docs/nebius-hackathon-plan.md).
--
-- The app reads its own assistant_messages, but assistant_jobs stays
-- service_role only. Without this, a message whose job failed would show
-- "typing" forever. This returns the caller's own chat jobs that have no reply
-- yet: pending (queued, the relay hasn't picked it up), leased (the agent is
-- working on it) or failed in the last 24 hours (every attempt used; the app
-- offers to send it again). Only the message id and the status leave the
-- table, never the error text or the lease.
create or replace function public.assistant_my_open_jobs()
returns table (message_id uuid, status text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select j.message_id, j.status, j.updated_at
  from public.assistant_jobs j
  where j.user_id = (select auth.uid())
    and j.kind = 'chat'
    and j.message_id is not null
    and (
      j.status in ('pending', 'leased')
      or (j.status = 'failed' and j.updated_at > now() - interval '24 hours')
    )
  order by j.created_at, j.id;
$$;

revoke execute on function public.assistant_my_open_jobs() from public, anon;
grant execute on function public.assistant_my_open_jobs() to authenticated, service_role;
