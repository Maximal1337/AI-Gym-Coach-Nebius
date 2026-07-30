-- session-start already reused an existing open session on retry (avoiding
-- orphan session rows), but still re-ran the LLM call every time regardless
-- — a client that backgrounds mid-request (killing the in-flight fetch,
-- common during Fly.io's cold-start window) and retries would silently pay
-- for a second LLM call for the same logical action. Caching the computed
-- intro response lets a retry replay it instead of recomputing it.
alter table public.workout_sessions
  add column intro_response jsonb;
