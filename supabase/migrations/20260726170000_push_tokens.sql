-- M2: Expo push tokens (GYM-31, passive relay). Client-writable: a user
-- registers/refreshes only their own token.

create table public.push_tokens (
  user_id uuid not null references public.users (id) on delete cascade,
  token text not null,
  platform text not null default 'ios' check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon;

create policy push_tokens_select_own on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_tokens_insert_own on public.push_tokens
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_tokens_update_own on public.push_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));
