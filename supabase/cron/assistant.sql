-- Supabase Cron schedules for the coach chat (docs/nebius-hackathon-plan.md,
-- NH-63). NOT a migration: it starts calling a deployed function, so it is
-- applied by hand in the SQL editor, once the pieces it calls exist:
--
--   1. supabase functions deploy memory-nightly --no-verify-jwt
--   2. supabase secrets set MEMORY_CRON_SECRET=... MEMORY_TOKEN_FACTORY_API_KEY=... MEMORY_MODEL=...
--   3. the two Vault entries below, with real values (run once)
--
-- Re-running this file is safe: cron.schedule replaces a job with the same
-- name. To stop a job: select cron.unschedule('memory-nightly');
-- Runbook and checks: docs/assistant-ops.md.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Run once, with real values, then keep this commented out:
-- select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
-- select vault.create_secret('<the MEMORY_CRON_SECRET value>', 'memory_cron_secret');

-- The nightly memory job: every 10 minutes from 00:00 to 02:59 UTC. Each call
-- processes the users due today until its time budget runs out; the next call
-- picks up the rest, and users already done today are skipped.
select cron.schedule(
  'memory-nightly',
  '*/10 0-2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/memory-nightly',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'memory_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- The proactive daily check-in (NH-66): queue one per opted-in user at 06:00
-- UTC (09:00 in Tel Aviv until 2026-10-25, 08:00 after: all of judging).
-- Pure SQL, no HTTP; the relay picks the jobs up.
select cron.schedule(
  'assistant-checkins',
  '0 6 * * *',
  $$ select public.assistant_enqueue_checkins(); $$
);
