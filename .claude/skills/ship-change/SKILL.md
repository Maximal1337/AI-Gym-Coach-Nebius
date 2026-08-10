---
name: ship-change
description: Deploy a change to AI-Gym-Coach (Supabase DB migrations/edge functions, the Fly.io agent service). Use once a change has already passed the `verify` skill's checks and needs to go live — covers which command each layer needs, deploy ordering when a migration and function change land together, and locale-key discipline for new user-facing strings.
---

# Shipping a change in AI-Gym-Coach

This repo is a monorepo: `apps/mobile` (Expo/React Native), `services/agent`
(Deno-adjacent Node LLM microservice, deployed to Fly.io as `gymcoach-agent`),
and `supabase/` (Postgres migrations + Deno edge functions). A single
feature often touches two or three of these at once — each has its own
deploy command and its own way of silently failing if you skip a step.

## 1. Verify before deploying

Full procedure (mobile bundle-compile trick, `deno check`, agent
tsc/test, locale JSON validation) lives in the **`verify`** skill — use it.
One correction to old assumptions here: **`deno` IS available in this
sandbox** (`deno 2.9.4` at least as of this writing) — a previous version of
this note said otherwise; that was wrong, or the environment changed.
Typecheck an edge function with:
```bash
DENO_NO_PACKAGE_JSON=1 deno check --no-config supabase/functions/<name>/index.ts
```
It will report pre-existing `GenericStringError` noise from the untyped
Supabase client — see `verify` for how to tell that apart from errors you
actually introduced.

**New user-facing string**: add the same key to all three locale files —
`apps/mobile/src/locales/en.json`, `he.json`, `ar.json` — never just one.
A hand-edited locale file can silently break at runtime on a trailing comma
with no typecheck error, so validate every file you touched:
`python3 -c "import json; json.load(open('FILE'))"` (repeat per file).

## 2. Deploy — map the change to the layer

| Changed path                     | Command                                                                 |
|-----------------------------------|--------------------------------------------------------------------------|
| `supabase/migrations/*.sql`       | `supabase db push`                                                       |
| `supabase/functions/<name>/*`     | `supabase functions deploy <name>` (space-separate multiple names to deploy several in one call) |
| `services/agent/*`                | `fly deploy -c services/agent/fly.toml --dockerfile services/agent/Dockerfile` |
| `apps/mobile/*` only               | No deploy step — ships with the app itself.                              |

- **`supabase/functions/_shared/mod.ts` is bundled INTO every function that
  imports it at deploy time — it is not a separately-deployed shared unit.**
  Changing something in `_shared/mod.ts` and deploying only the one function
  you were focused on leaves every OTHER function that imports the changed
  export running the stale bundled copy. Find who else needs redeploying:
  `grep -rl "<changed export name>" supabase/functions --include="index.ts" | grep -v _shared`.
  (Changing `profileToAgent`'s signature this session meant `session-start`
  and `coach-turn` both needed redeploying alongside the function actually
  being worked on.)
- **If a migration removes/renames something a currently-deployed function
  reads, deploy the function fix FIRST, then `supabase db push`.** Migrating
  first breaks the still-live old code in the gap between the two steps
  (dropping a column before redeploying the functions that read it 500s
  every request that touches it until the redeploy lands).
- **The `fly deploy` command must run from the repo root, not
  `services/agent/`.** The Dockerfile's `COPY packages/shared`,
  `COPY pnpm-workspace.yaml`, etc. need the monorepo root as build context —
  running it from inside `services/agent/` fails with "not found" errors on
  those COPY lines.
- "Docker is not running" warnings printed by `supabase db push` /
  `supabase functions deploy` are non-fatal — ignore them, the commands
  still complete. A `WARNING: The app is not listening on the expected
  address` during a `fly deploy` rolling restart is usually a transient
  health-check race, not a real failure — check the real state after (next
  bullet) before assuming something's wrong.
- After a `fly deploy`, confirm it actually came up:
  `curl -s -o /dev/null -w "healthz: %{http_code}\n" https://gymcoach-agent.fly.dev/healthz`
  — expect `200`.
- `supabase migration list` shows local-vs-remote timestamps side by side
  (empty `remote` = still pending) — check it before AND after `db push` to
  confirm what actually applied, rather than trusting the push command's own
  output alone.

## 3. Never build/submit the app without asking

`eas build` / `eas submit` always needs explicit user approval first, even
if you're mid an already-approved batch of changes — this is a standing
rule for this repo, not a one-time confirmation. See
`apps/mobile/AGENTS.md` for the `--non-interactive` flag requirement once
approved.

## 4. Commit style

Check `git log --oneline -10` before writing a message — this repo uses
terse, imperative one-liners ("Add X", "Fix Y", "Rename Z"), with a short
body (1-2 sentences) explaining *why*, not what. A multi-file change that
was built and tested as one unit ships as one commit, not one per file.
Only commit/push when the user explicitly asks.
