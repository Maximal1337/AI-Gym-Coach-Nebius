---
name: subscription-entitlement-gating
description: Gate AI/coaching-value endpoints behind the trial/subscription entitlement check in AI-Gym-Coach — where the check actually needs to live (every value-producing endpoint, not just "start" ones), the Gym-vs-Studio structural asymmetry, and client-side front-loading for UX. Use when adding a new AI-calling endpoint, a new "start a session"-shaped flow, or when a user reports the paywall as bypassable.
---

# Gating AI value behind entitlement, completely

The first pass at this feature only gated `session-start`, `plan-generate`,
and `studio-session`'s generate branch — the three obvious "start something
new" entry points. Real testing immediately found it wasn't enough: a user
whose trial had expired could still chat indefinitely in an already-open
session, still repeat a past Studio workout, still build a blank Studio
board from scratch. Each of those was a separate real bug report, not a
hypothetical.

## The actual rule: gate every endpoint that produces value, not just "start"

`subscriptionAccess()` (in `_shared/mod.ts`) needs to be checked in **every**
endpoint that does something a non-subscriber shouldn't get for free —
concretely, everywhere `callAgent()` is called, plus a few write-only paths
that complete a value-producing flow without a further LLM call. To find
the full list: `grep -rl "callAgent" supabase/functions --include="index.ts"`,
then check each hit actually has the gate. This session the full list ended
up being: `session-start`, `coach-turn` (every mid-session message, not just
the first), `plan-generate`, `plan-import`'s `parse`/`commit`, `history-import`'s
`parse`/`commit`, and `studio-session`'s `open`/`update`/`save`/`reparse`.

`coach-turn` was the biggest miss: it's the endpoint every single chat
message goes through once a session is running, and it had **zero**
entitlement check — a session opened before a trial expired became an
unmetered way to keep chatting forever. Original design intentionally
skipped a *budget* check there ("a session already running is never cut off
mid-set," a cost consideration) — but entitlement is a different axis from
cost, and the same reasoning doesn't carry over. If the paywall's whole
point is monetization, cutting off value mid-session on expiry is exactly
what's supposed to happen, even if a *cost* check shouldn't.

## Gym vs. Studio: the same value has a different shape

Gym separates "create a plan" (manual build, paste, photo, AI-generate —
all go through `plan-import`'s `commit`, which is deliberately **not**
gated) from "start a session against that plan" (`session-start`, which
**is** gated). That split matters: because actually training still requires
`session-start`, letting plan *creation* stay free doesn't leak the
product's paid value.

Studio has no equivalent second step — `studio-session`'s `open` action
(blank/copy/generate/parse, all four branches) directly produces a live,
usable session in one call. There's no separate "start" checkpoint after
it. That means gating only the AI-cost branches (generate, parse) and
leaving `blank`/`sourceSessionId` (copy an old workout) ungated is a real
hole, not a reasonable free tier — a locked-out user could still get
unlimited live Studio sessions via "build it yourself" or "do one again,"
forever. **Gate the whole `open` action, unconditionally, regardless of
branch** — that's the actual Studio equivalent of Gym's `session-start`
gate, not the parse/generate sub-branches alone.

## Defense in depth: also gate resuming an in-progress resource

`update`/`save` on an unsaved Studio session are reachable even when `open`
is gated, for one legitimate case: a session opened while still entitled,
edited after the trial expired mid-session. Gate those too — cheap, and
closes the gap without needing to guess whether it'll actually happen often.

## Client-side front-loading (UX only — server is still the real gate)

Checking entitlement only server-side means a locked-out user fills out a
whole 5-question AI-generate form, or takes 3 photos, before ever finding
out they're blocked. Fetch the already-cached client-side status
(`fetchAccessStatus()` from `apps/mobile/src/lib/subscription.ts`) and
front-load the same check at the point of intent — before opening a
multi-step form, before making the network call at all. This must never
*replace* the server check, only skip a doomed round trip; the server call
still happens for any path that doesn't have a client-side pre-check wired
up, and stays the actual enforcement boundary regardless.

## Checklist for adding a new AI-calling endpoint

1. Does it call `callAgent()`, or otherwise complete a flow a free/expired
   user shouldn't get? If yes, add `subscriptionAccess()` at the top,
   before any other work.
2. Is it "starting" something (Gym) or "starting-and-defining-in-one-call"
   something (Studio-shaped)? The latter needs the gate on *every* branch,
   not just the ones with an obvious LLM cost.
3. Does the client have a natural pre-check point (a button tap before a
   multi-step form, before a camera/upload flow)? Add the client-side
   front-load there, and make sure the error handler recognizes
   `subscription_required` specifically (not just a generic failure) and
   routes to `/subscribe`.
