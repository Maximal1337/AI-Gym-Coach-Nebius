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

## Where the pieces live

- `supabase/functions/dev-test-login/index.ts` — the email allow-list
  (`TEST_EMAILS`) and instant sign-in (generates + immediately verifies a
  magic-link OTP server-side, no real email sent).
- `dev_test_reset_account(uuid)` — a `security definer` Postgres function
  (see the `postgrest-security-definer-writes` skill for why it has to be
  one, not a direct table write from the edge function) that does the
  actual state reset. Resolves **both** the target account's validity and
  which scenario to apply from a fixed `email → scenario` mapping inside
  the function body itself — never from a caller-supplied parameter — so
  it's safe to grant broadly regardless of which role ends up calling it.
- `apps/mobile/app/sign-in.tsx` — `DEV_TEST_ACCOUNTS`, one dev-only button
  per scenario, each just POSTs its email to `dev-test-login`.

## The reset-every-login principle

State resets on **every** sign-in for these accounts, not just once at
creation. Without this, "the expired one" drifts the moment you actually
use the app with it (finish onboarding, a background job fires, etc.) and
silently stops reproducing the scenario it's named for. `dev_test_reset_account`
is idempotent by design — safe to call repeatedly with no accumulating side
effects (an `upsert`/`on conflict do update` for the onboarded case, a
plain `delete` for the fresh case).

## Adding a new scenario

1. Add the email to `TEST_EMAILS` in `dev-test-login/index.ts`.
2. Add the case to `dev_test_reset_account`'s email→scenario mapping — this
   means a **new migration** (`create or replace function`), since editing
   an already-applied migration file's content is a no-op for `db push`
   (see `postgrest-security-definer-writes` for why).
3. Add a button to `DEV_TEST_ACCOUNTS` in `sign-in.tsx` with a clear label.
4. Deploy the migration (`supabase db push`) **and** redeploy the function
   (`supabase functions deploy dev-test-login`) — both layers changed.
5. Verify with a real login, not just a code read — call the function
   directly (`live-backend-debug` skill's curl pattern) and check the
   actual DB row afterward, since a `security definer` function failing
   silently mid-body is exactly the kind of bug that looks fine from the
   code alone.

## The App Review account is a deliberately different case

`ios-review-<random>@notch.app` (Apple App Reviewer instant sign-in,
allowed in every build, not just `__DEV__`) shares the same endpoint but is
**not** in the reset allow-list — it behaves like a genuine first-time
signup, real onboarding, real persisted data, on purpose. The point is
giving Apple's reviewer the actual product experience, not a canned demo
state. See `secrets/app-review-account.md` for the full rationale and the
exact App Store Connect fields it needs to be pasted into.

## Gotcha: device-local state needs its own separate reset

Language choice (`apps/mobile/src/lib/language.tsx`) is stored in
`AsyncStorage`, not the server — deliberately, so a device keeps its
language across different signed-in accounts. Resetting the server-side
`public.users` row for a "no data / always onboarding" scenario does
**not** touch it. If a scenario needs to reproduce true first-launch
behavior (onboarding-language screen included), reset that separately and
explicitly — see `resetLanguageChoice()` and its one call site in
`sign-in.tsx`'s `devTestLogin()`, gated to only the specific scenario that
needs it.
