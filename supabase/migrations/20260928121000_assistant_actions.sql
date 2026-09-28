-- Audit trail for the coach chat's write tools (NH-44, D-22 in
-- docs/nebius-hackathon-plan.md).
--
-- The assistant acts without an "are you sure?" round trip, but only inside
-- D-22's narrow scope — save a note, swap or replace one exercise in one
-- active plan — and every write it makes lands here first, with enough
-- before/after state for undo_last_change to revert it within 24 hours. An
-- undo is itself recorded, as a row pointing at the action it reverted.
--
-- Clients can read their own trail (the reply says what changed; the app can
-- show it); only notch-tools writes, on the service_role client.
create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('save_note', 'adjust_plan_exercise', 'undo')),
  before jsonb check (before is null or jsonb_typeof(before) = 'object'),
  after jsonb check (after is null or jsonb_typeof(after) = 'object'),
  -- For kind = 'undo': the action this one reverted. Unique, so an action
  -- can be undone at most once.
  undoes uuid unique references public.assistant_actions (id) on delete cascade,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  check ((kind = 'undo') = (undoes is not null)),
  check (kind <> 'undo' or undone_at is null),
  check (kind <> 'save_note' or after is not null),
  check (kind <> 'adjust_plan_exercise' or (before is not null and after is not null))
);

create index assistant_actions_user_created_idx
  on public.assistant_actions (user_id, created_at desc);

alter table public.assistant_actions enable row level security;
revoke all on public.assistant_actions from anon;
revoke insert, update, delete on public.assistant_actions from authenticated;
grant select on public.assistant_actions to authenticated;
grant all on public.assistant_actions to service_role;

create policy assistant_actions_select_own on public.assistant_actions
  for select to authenticated using (user_id = (select auth.uid()));
