---
name: live-backend-debug
description: Reproduce and debug a failure the user reports in a live Edge Function / agent service flow — get a real auth token and call the function directly with curl, without needing the mobile app, a simulator, or the user's own credentials. Use when the user reports something "failing" or "not working" in the app and the cause isn't obvious from reading the diff.
---

# Debugging a live failure in AI-Gym-Coach

When the user reports a flow failing in the app, don't guess from code
review alone if you can reproduce it directly — this repo has a dev-only
mechanism for getting a real, valid session token without a simulator, a
device, or the user's real credentials.

This is the "exercise the actual endpoint" half of live diagnosis; the
`db-diagnose` skill covers the "query the actual table state" half — see its
note on which to reach for first depending on how the bug was reported.

## Get a real auth token

`supabase/functions/dev-test-login` is a dev-only instant-sign-in endpoint
for exactly one hardcoded test account (`dor@test.com` at the time of
writing — confirm the current `ALLOWED_EMAIL` in that file, don't assume).
It's the same account the in-app dev sign-in button uses in Expo Go, so
**data you see through it is very likely the user's own live test data, not
throwaway fixtures** — see the caution below.

```bash
SUPA_URL="https://pjaeqxgwrctwnvugsqlx.supabase.co"
ANON_KEY="<EXPO_PUBLIC_SUPABASE_ANON_KEY from apps/mobile/.env>"
curl -s -X POST "$SUPA_URL/functions/v1/dev-test-login" \
  -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"dor@test.com"}' > /tmp/login.json
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['accessToken'])")
```

## Reproduce the exact call the client makes

Find the client's `callFn(name, body)` call in the relevant screen/flow
(`apps/mobile/src/lib/*.ts`), then hit the same Edge Function directly:
```bash
curl -s -w "\nHTTP:%{http_code}\n" -X POST "$SUPA_URL/functions/v1/<function-name>" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '<same JSON body the client sends>' --max-time 60
```
A clean, structured error response (not a crash, not a timeout) usually
means auth and validation are fine and the real bug is either upstream
(nothing was ever deployed — see `backend-deploy`) or in how the *client*
handles that specific error code, not in the endpoint itself. That
distinction is the single highest-value thing this technique tells you —
in this session it revealed that "AI-generate fails" and "photo parsing
fails" were both the client mishandling an ordinary `409
session_already_open` response, not a broken backend.

## Caution: this is very likely real, current user data

Because `dev-test-login` is the same account the user tests with in Expo Go,
anything you list (`{"action":"list"}` on `studio-session`, etc.) may be
their actual in-progress work, not disposable test fixtures. Before deleting
or discarding anything to unblock your own testing:
- Check timestamps — something from minutes ago during an active
  conversation is probably the user testing live right now; leave it alone.
- Something clearly stale (yesterday, from earlier in a long build session)
  is more likely safe to clean up (e.g. `{"action":"discard","sessionId":...}`
  for an abandoned open studio session) — but say so transparently rather
  than silently deleting it.
- When genuinely unsure, tell the user what you found and ask, rather than
  guessing.

## Fly.io agent service logs

```bash
cd services/agent && fly logs --no-tail
```
Shows machine start/stop/health-check noise by default (this app scales to
zero when idle) — actual request-level errors only appear if the handler's
own `console.error`/`Sentry.captureException` fired. Absence of any log line
for your request is itself informative: it means the request never reached
the agent at all (failed earlier, at the Edge Function or client).

## Supabase Edge Function logs — known dead end

This CLI version (`supabase 2.109.1`) has **no** `supabase functions logs`
subcommand. The Management API's log-query endpoint
(`GET /v1/projects/{ref}/analytics/endpoints/logs.all?sql=...`, using the
CLI's cached token at `~/.supabase/access-token`) exists and responds `200`,
but returned empty results in practice even for calls known to have just
happened — don't spend time on it. Direct `curl` reproduction (above) is the
reliable path; it also tells you strictly more, since you see the exact
response body and status code rather than an indirect log line.
