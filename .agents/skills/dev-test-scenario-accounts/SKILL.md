---
name: dev-test-scenario-accounts
description: Add or modify a deterministic, named QA test account (like "subscription ended" or "no data") in AI-Gym-Coach's dev-test-login system. Use when adding a new test scenario, changing what state an existing one resets to, or debugging why a scenario account isn't showing the expected state after login.
---

# Named, deterministic QA accounts via instant sign-in

`dev-test-login` started as one hardcoded test account for skipping email
OTP in Expo Go. It grew into a small set of accounts, each pinned to a
specific product state, reset fresh on every single login — useful for
anything that's otherwise slow or awkward to reach organically (a 30-day
trial expiring, an account with zero data).

**No test address may appear in the repository.** The repo is public, and
every allowlisted address signs in without a one-time code — an address in
the code is a password in the code. All addresses live in secrets and
out-of-band data only (NH-06).

## Where the pieces live

- `DEV_TEST_LOGIN_EMAILS` Supabase secret — the instant-sign-in allowlist
  (comma-separated, lowercase), read by
  `supabase/functions/dev-test-login/index.ts`. Unset means nothing is
  allowed. Documented in `supabase/functions/.env.example`.
- `private.dev_test_accounts (email, scenario)` — which accounts reset, and
  to what (`active` | `expired` | `fresh`). The `private` schema isn't
  exposed through PostgREST; rows are written out of band (SQL editor or
  `supabase db query --linked`), never in a migration.
- `dev_test_reset_account(uuid)` — a `security definer` Postgres function
  (see the `postgrest-security-definer-writes` skill for why it has to be
  one, not a direct table write from the edge function) that does the
  actual state reset. It resolves the account's email from `auth.users` and
  its scenario from `private.dev_test_accounts` inside the function body —
  never from a caller-supplied parameter — so it's safe to grant broadly
  regardless of which role ends up calling it. Current version:
  `20260918120000_dev_test_accounts_private.sql`.
- `apps/mobile/app/sign-in.tsx` — dev-only buttons built from the local
  `EXPO_PUBLIC_DEV_TEST_ACCOUNTS` env var (JSON array of
  `{ email, label, resetLanguage? }`, see `apps/mobile/.env.example`); each
  POSTs its email to `dev-test-login`.

## The reset-every-login principle

State resets on **every** sign-in for these accounts, not just once at
creation. Without this, "the expired one" drifts the moment you actually
use the app with it (finish onboarding, a background job fires, etc.) and
silently stops reproducing the scenario it's named for. `dev_test_reset_account`
is idempotent by design — safe to call repeatedly with no accumulating side
effects (an `upsert`/`on conflict do update` for the onboarded case, a
plain `delete` for the fresh case).

## Adding a QA account for an existing scenario

No code change and no deploy of code:
1. Pick a random, non-guessable address (e.g. `qa-expired-<random>@example.com`).
2. Add it to the `DEV_TEST_LOGIN_EMAILS` secret
   (`supabase secrets set DEV_TEST_LOGIN_EMAILS=...` — the value replaces the
   whole list, so include the existing addresses).
3. Add its row: `insert into private.dev_test_accounts (email, scenario)
   values ('<address>', 'expired');`
4. For the Expo Go button, add it to your local `EXPO_PUBLIC_DEV_TEST_ACCOUNTS`
   (with `"resetLanguage": true` for a "no data" account).
5. Verify with a real login (below).

## Adding a new scenario type

1. New migration (`create or replace function public.dev_test_reset_account`)
   with the new case, plus widening the `scenario` check constraint on
   `private.dev_test_accounts`. Editing an already-applied migration file's
   content is a no-op for `db push` (see `postgrest-security-definer-writes`).
2. `supabase db push`, then add accounts as above.
3. Verify with a real login, not just a code read — call the function
   directly (`live-backend-debug` skill's curl pattern) and check the
   actual DB row afterward, since a `security definer` function failing
   silently mid-body is exactly the kind of bug that looks fine from the
   code alone.

## App Review and demo/judge accounts are deliberately different

They share the same endpoint and secret allowlist but have **no row** in
`private.dev_test_accounts`, so they are never reset: they behave like a
genuine signup, real onboarding, real persisted data — giving Apple's
reviewer (or a hackathon judge) the actual product experience. They must use
the app's instant-sign-in domain (`@notch.app`, `INSTANT_SIGN_IN_DOMAIN` in
`sign-in.tsx`): the production app only asks `dev-test-login` for addresses
on that domain, in every build, and falls back to the normal one-time code
when the server doesn't allowlist the address. The review address is entered
in App Store Connect → App Review Information; keep the details in the
git-ignored `secrets/` folder, never in the repo.

## Demo and judge accounts

Demo and judge accounts get two weeks of realistic history — plan, eight
workouts, workout chat, saved notes, and the `assistant_chat` /
`assistant_memory` feature flags — from `private.seed_demo_account(email)`
(migration `20260918140000_demo_accounts.sql`). The function wipes the
account's plans, workouts, notes, studio sessions and usage first, so it only
runs for addresses registered in `private.demo_accounts`. It also refuses QA
scenario accounts, whose state resets on every login. Setup, per account
(one team demo account plus one per judge):

1. Pick a random address on the instant-sign-in domain, e.g. `judge-<random>@notch.app`.
2. `insert into private.demo_accounts (email, label) values ('<address>', 'Judge 1');`
3. Add the address to the `DEV_TEST_LOGIN_EMAILS` secret (the value replaces the whole list).
4. Create the auth user by signing in once through dev-test-login — the
   `live-backend-debug` curl call is enough, no device needed.
5. `select private.seed_demo_account('<address>');` — returns counts:
   2 plans, 10 exercises, 8 workouts, 128 sets, 32 messages, 2 notes.

History is placed relative to `now()`. Right before judging, re-seed every
account so the two weeks line up with the judging window and anything a
tester changed is reset:
`select email, private.seed_demo_account(email) from private.demo_accounts order by email;`
The in-app language choice is device-local, so a first launch on a new
device still shows the language screen once.

## Gotcha: device-local state needs its own separate reset

Language choice (`apps/mobile/src/lib/language.tsx`) is stored in
`AsyncStorage`, not the server — deliberately, so a device keeps its
language across different signed-in accounts. Resetting the server-side
`public.users` row for a "no data / always onboarding" scenario does
**not** touch it. If a scenario needs to reproduce true first-launch
behavior (onboarding-language screen included), set `resetLanguage: true`
on that account in `EXPO_PUBLIC_DEV_TEST_ACCOUNTS` — `instantSignIn()` in
`sign-in.tsx` then calls `resetLanguageChoice()` for it.
