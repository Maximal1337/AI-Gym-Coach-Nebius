---
name: app-version-gate
description: Operate or change AI-Gym-Coach's app-version gate (server-controlled force-update + soft "update available" nudge) and the post-workout App Store review prompt. Use when the user wants to force users onto a newer build, nudge an optional update, set the App Store URL, turn the gate off, or work on the in-app review prompt — plus the Apple rules and the safety guardrails that keep a bad value from bricking the app.
---

# App-version gate + review prompt

Two shipped mechanisms. The **gate** is server-controlled so it can be flipped
without an app release; the **review prompt** asks for an App Store rating once
after a completed workout.

## The gate — how it's wired

- Server row: `public.app_config` (one row per platform; only `ios` today),
  columns `min_supported_version`, `latest_version`, `store_url`. Public read
  (anon + authenticated RLS), no client write.
- **Hard block:** running `<` `min_supported_version` → the `/force-update`
  dead-end screen. **Soft:** running `<` `latest_version` (and not blocked) →
  a dismissible, once-per-version nudge.
- **Seeded OFF:** `min '0.0.0'` (blocks nobody), `latest` = current shipping
  version (no nudge), `store_url` null.

## Operating it — edit the row, no app release needed

```sql
-- Force update (BREAKING changes only). GUARDRAIL below.
update public.app_config set min_supported_version = '1.2.0', updated_at = now() where platform='ios';
-- Soft nudge for an optional update:
update public.app_config set latest_version = '1.2.0' where platform='ios';
-- Set the store link (do this BEFORE ever forcing):
update public.app_config set store_url = 'https://apps.apple.com/app/id<APPID>' where platform='ios';
-- Turn the gate OFF / undo a mistake:
update public.app_config set min_supported_version = '0.0.0' where platform='ios';
```

## The three guardrails (the whole safety story — don't weaken them)

1. **Server-driven → reversible.** The threshold is one DB row; a bad value is
   fixed by editing it, no rebuild. The client only ever *reads* it.
2. **`min_supported_version` must never exceed the version actually LIVE on the
   App Store.** Blocking users onto a build that doesn't exist yet strands them
   with nothing to update to. Only ever raise it to an already-downloadable
   version. (For App Review: keep `min` ≤ the version being reviewed so the
   reviewer never sees the wall — see Apple rules.)
3. **Fail-open, everywhere.** Any error/timeout/missing row → no block.
   `runningVersion()` falls back to `''` (NOT `'0.0.0'`, which is below every
   real min and would wrongly force-update). The pure logic only blocks on a
   confirmed `running < a real min`.

## Code map

- `apps/mobile/src/lib/appUpdateLogic.ts` (+ `.test.ts`, 12 tests) — PURE,
  RN-free: `compareVersions`, `deriveUpdateStatus`. All the safety asserts live
  here; extend the tests when touching the logic.
- `apps/mobile/src/lib/appUpdate.ts` — IO: `fetchUpdateStatus` (3s timeout +
  fail-open), `runningVersion`, `useUpdateNudge`.
- `apps/mobile/app/force-update.tsx` — the blocking screen; the Update button
  ALWAYS renders with `FALLBACK_STORE_URL` so a null `store_url` can't create a
  buttonless dead-end.
- `apps/mobile/app/index.tsx` — the gate runs in `Promise.all` with
  `getSession` (no launch latency), before auth; the effect body is wrapped in
  try/catch so a rejected getSession can't strand a blank loader.
- `supabase/migrations/*_app_config.sql` — the table + RLS + seed.

## Apple rules (verified against developer.apple.com)

- **No official force-update API.** Apple's recommended path is **Phased
  Release** (App Store Connect, 7-day rollout) + automatic updates, NOT forcing.
- **Guideline 3.2.2(x)** ("must not force users to … other store-related
  actions in order to access functionality") makes a hard wall a **gray area** —
  it's tolerated for a genuine deprecation, not blessed. Only hard-block a
  version that truly can't function, add an **App Review note** explaining it,
  and keep `min` ≤ the version under review.

## The review prompt

- `apps/mobile/src/lib/review.ts` — `maybeRequestReview()`: once-ever
  (AsyncStorage `notch:reviewRequested`), `StoreReview.requestReview()`
  (`expo-store-review`), fire-and-forget, fully swallowed (never blocks the
  workout flow).
- Called from BOTH completion paths — `train.tsx` `finish()` (Gym) and
  `StudioSessionScreen.finishSave()` (Studio, gated on `!onboarding`). Once-ever
  means they share one budget.
- Apple: never wire it to a "Rate us" button (use `StoreReview.storeUrl()` for
  that); the OS throttles to ~3/yr, gives no result (so never gate on it), and
  **only shows the sheet in real App Store builds — NOT TestFlight or the
  simulator** (expected, not a bug).
