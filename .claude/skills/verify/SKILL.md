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
3. Locale files: after editing `src/locales/*.json`, run
   `node scripts/check-locales.mjs` from the repo root. It validates JSON
   syntax, key parity with `en.json`, and `{{placeholder}}` parity across all
   eight locales — a trailing comma or bad escape silently breaks the app for
   one language only, easy to miss. CI runs the same script.

## Backend — Supabase Edge Functions (Deno)

1. Run `node scripts/check-edge-functions.mjs` from the repo root (needs
   `deno` on PATH). It `deno check`s every function plus every `_shared/*.ts`
   module and fails only when a file has more type errors than recorded in
   `scripts/deno-check-baseline.json`. CI runs the same script.
2. **Pre-existing errors are baselined, not zero.** As of 2026-09-18 only
   `session-start` (1) and `studio-session` (31, mostly `GenericStringError`
   from the Supabase client having no generated DB types) have any. Don't
   chase them in unrelated work. If you fix some, or add a new function,
   review the output, run `node scripts/check-edge-functions.mjs --update`,
   and commit the updated baseline.
3. Quick single-function check while iterating:
   ```bash
   DENO_NO_PACKAGE_JSON=1 deno check --no-config supabase/functions/<name>/index.ts
   ```
   With `--no-config` there's no lockfile, so `npm:` imports resolve to the
   latest matching version at check time — a new upstream release of
   supabase-js can move the counts without any change in this repo.
4. Unit tests for pure shared modules (`_shared/*.test.ts`, e.g. the memory
   scoring module) run with Deno; CI runs the same command:
   ```bash
   DENO_NO_PACKAGE_JSON=1 deno test --no-config supabase/functions/
   ```

## Backend — agent service (Node)

```bash
cd services/agent && npm run typecheck   # tsc --noEmit
npm test                                  # node:test, src/*.test.ts
```

## Cluster manifests (`deploy/`) and the image workflow

No cluster here either; these catch what can be caught offline. CI runs the
first one.

```bash
node --test scripts/*.test.mjs                # the Images workflow's tag bump
kubectl kustomize deploy/notch/overlays/prod  # renders; also dev and deploy/platform/agent-sandbox
for f in deploy/bootstrap/*.sh; do bash -n "$f"; done   # shell syntax
```

Anything that needs k3s, Argo CD or OpenShell (sync, NetworkPolicy
enforcement, the gateway's Helm hooks) is verified on the VPS — see
`deploy/README.md`, "Checked only on the VPS".

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
