---
name: verify
description: Verify a change in this repo actually works — no iOS/Android simulator is available in this environment, so mobile changes are verified via a forced full Metro bundle compile, and backend changes via Deno/tsc typecheck plus a live curl smoke test against the deployed Supabase project.
---

# Verifying changes in AI-Gym-Coach

This is a pnpm monorepo with three independently-runtime pieces:
`apps/mobile` (Expo/React Native), `services/agent` (Node, deployed to Fly.io),
`supabase/functions/*` (Deno Edge Functions) + `supabase/migrations`.

**No iOS Simulator or Android emulator is available in this sandboxed
environment** (`xcrun simctl` and `adb` are both absent). Never claim a mobile
change "works" from typecheck alone — use the bundle-compile technique below,
which is the closest thing to actually running the app that's available here.

## Mobile (`apps/mobile`)

1. Typecheck: `cd apps/mobile && npx tsc --noEmit`
2. **Force a full Metro bundle compile** — this is the real signal. `tsc`
   misses broken imports across renamed routes, JSX errors in files outside
   the type graph, and Expo Router route-registration issues. A full,
   non-lazy bundle build catches all of that:
   ```bash
   cd apps/mobile
   (npx expo start --port 8099 > /tmp/expo-start.log 2>&1 &)
   for i in $(seq 1 15); do
     curl -s -o /dev/null -w "%{http_code}" http://localhost:8099/status | grep -q 200 && break
     sleep 2
   done
   curl -s "http://localhost:8099/node_modules/expo-router/entry.bundle?platform=ios&dev=true&minify=false&lazy=false" \
     -o /tmp/bundle.js -w "HTTP:%{http_code} SIZE:%{size_download}\n" --max-time 120
   tail -n 30 /tmp/expo-start.log
   pkill -f "expo start --port 8099"; pkill -f metro
   ```
   Look for `HTTP:200` and a `Bundled ... (N modules)` line with no errors in
   the log. `lazy=false` is required — the default `lazy=true` only bundles
   the initial route and won't catch errors in routes you haven't navigated
   to. The URL path itself matters: Expo Router's entry is
   `node_modules/expo-router/entry.bundle`, not `index.bundle` — hitting the
   wrong path 404s. If unsure of the exact entry path, fetch `/` (no
   platform param) first — the returned HTML's `<script src=...>` shows the
   correct bundle URL and query params for this Expo version.
3. Locale files: after editing `src/locales/*.json`, validate with
   `python3 -c "import json; json.load(open('FILE'))"` for each of
   `en.json`/`he.json`/`ar.json` — a trailing comma or bad escape silently
   breaks the app for one language only, easy to miss.

## Backend — Supabase Edge Functions (Deno)

1. `deno` is installed locally. Typecheck a specific function (fast, doesn't
   need Docker):
   ```bash
   DENO_NO_PACKAGE_JSON=1 deno check --no-config supabase/functions/<name>/index.ts
   ```
2. **This will report pre-existing errors unrelated to your change** — the
   Supabase client here has no generated DB types, so `.select()` results
   type as `GenericStringError` and Deno's checker (stricter than whatever
   tolerance the actual Edge Runtime has) flags every property access on
   them. Don't chase these. Compare against baseline before assuming you
   introduced something:
   ```bash
   git stash && DENO_NO_PACKAGE_JSON=1 deno check --no-config supabase/functions/<name>/index.ts > /tmp/before.txt 2>&1
   git stash pop
   # then diff the error *line numbers near your edit* against /tmp/before.txt
   ```
   If your new code's line range has zero errors and the rest match the
   baseline (shifted by however many lines you inserted), you're clean.
3. `supabase/functions/_shared/mod.ts` typechecks clean on its own —
   `DENO_NO_PACKAGE_JSON=1 deno check --no-config supabase/functions/_shared/mod.ts`
   is a useful fast check when only touching that file.

## Backend — agent service (Node)

```bash
cd services/agent && npm run typecheck   # tsc --noEmit
npm test                                  # node:test, src/*.test.ts
```

## End-to-end smoke test against the live deployed backend

There's no local Supabase/agent stack running in this environment — testing
against the live project is the only option. See the `live-backend-debug`
skill for how to get a real auth token and reproduce a flow with `curl`
without needing the mobile app or a simulator at all. Always do this for any
change to an Edge Function or the agent service before considering it done —
typecheck passing does not mean the deployed code path actually works
(wrong URL path, auth header shape, and request-body validation mismatches
between the mobile client and the function are all invisible to tsc/deno
check).
