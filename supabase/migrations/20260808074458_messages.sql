-- Durable coaching-reply transcript (lean version — see Linear doc
-- "Durable Coach Replies: Fixing Backgrounded/Closed-App Message Loss").
-- Today a coach reply exists only inside one fetch() the phone is
-- awaiting; if the app backgrounds/is killed mid-request, iOS suspends
-- or kills that in-flight request and the reply is gone for good. This
-- table gives every message somewhere durable to land regardless of
-- what the phone does — the client resumes from here on relaunch or on
-- returning to foreground, and a push notification points back to it.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  from_role text not null check (from_role in ('coach', 'me', 'system')),
  text text not null,
  -- The structured TurnResult/SessionStartResult body behind a coach
  -- message (or { confirmedSets } for a confirm-sets 'me' message) — lets
  -- a resumed client reconstruct exercise/targets/progress state the same
  -- way it does from a normal synchronous response, no second call needed.
  payload jsonb,
  -- Set by the client on send; the partial unique index below is the
  -- duplicate-send guard — a retried POST (double-tap, or
  -- pendingTurn.ts's reconnect retry) can't insert the same 'me' message
  -- twice or trigger a second LLM call for it (see mod.ts's
  -- findReplayReply, which replays the already-generated reply instead).
  client_message_id text,
  created_at timestamptz not null default now()
);

create index messages_session_created_idx on public.messages (session_id, created_at);

create unique index messages_client_message_id_idx
  on public.messages (session_id, client_message_id)
  where from_role = 'me' and client_message_id is not null;

alter table public.messages enable row level security;
revoke all on public.messages from anon;

-- Read-only for clients; every write goes through Edge Functions on the
-- service_role client, same pattern as set_logs/workout_sessions.
create policy messages_select_own on public.messages
  for select to authenticated using (user_id = (select auth.uid()));
