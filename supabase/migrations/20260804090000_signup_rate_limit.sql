-- GYM-55: throttle new-account creation velocity.
--
-- The monthly per-user LLM budget (§10) does nothing against a script
-- mass-creating accounts — each new account just gets its own fresh
-- budget. This is a blunt, project-wide backstop instead: reject new
-- signups outright once too many have landed in a short window.
--
-- Deliberately global rather than per-IP/per-device: auth.users doesn't
-- reliably carry the request IP, and the actual threat named for this
-- app's scale is burst account creation (a bot script), not one abusive
-- account slipping through — a velocity cap catches that directly.
-- 20 signups / 10 minutes is generous for organic adoption (e.g. a
-- TestFlight link posted somewhere causing a real burst) while still
-- stopping a runaway script. Tune by replacing this function.

create or replace function public.enforce_signup_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  recent_signups int;
begin
  select count(*) into recent_signups
  from auth.users
  where created_at > now() - interval '10 minutes';

  if recent_signups >= 20 then
    raise exception 'signup_rate_limited';
  end if;

  return new;
end;
$$;

create trigger enforce_signup_rate_limit
  before insert on auth.users
  for each row
  execute function public.enforce_signup_rate_limit();
