-- What a Supabase project provides before our first migration runs, cut down
-- to the parts the migrations use: the API roles, their default grants on
-- public, and auth.users with auth.uid(). Loaded by db.ts into a fresh
-- Postgres 17 (PGlite) ahead of supabase/migrations.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- Supabase grants every API role access to new objects in public; the
-- migrations then revoke what a role mustn't have. Without these defaults
-- a forgotten revoke would go unnoticed here.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
grant select on auth.users to service_role;

-- Supabase's definition: the JWT's subject, from either setting PostgREST uses.
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
