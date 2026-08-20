# App Store Connect — fill sheet

Ordered to match your exported PDF top to bottom (`App Store Connect.pdf`),
so you can go field by field without hunting for anything. Two fields
live on a *different* ASC page (App Information, not this version page)
but matter more than anything on this list for findability — do those
first.

---

## Do this first — App Information page (different tab)

**Name** (30 char limit)
```
AI Workout Coach - Notch
```
25 chars. This is the single highest-weight ASO field there is —
Apple's ranking algorithm indexes it more heavily than the Keywords
field. Leading with the generic term (`AI Workout Coach`) instead of
the brand (`Notch`) matters for two reasons: it's what actually gets
matched against what people type, and in a search-results list, users
scan left to right — leading with the recognizable category term reads
as "yes, this is what I searched for" before they even register the
brand name.

*Alternates worth validating with a real keyword-volume tool (Astro,
AppTweak — I can't check live search volume) before you lock this in:*
```
AI Gym Coach - Notch
Workout Tracker - Notch
```

⚠️ Note: this leads with "AI," which sits in tension with the voice
rule "avoid AI-powered as a lead." Name is pure ASO indexing though,
not narrative copy a reader experiences as "the coach talking," so
that's a defensible exception — but it's a call worth making
deliberately, not by default.

**Subtitle** (30 char limit) — options, none repeating a Name word:

| Option | Chars | Why |
|---|---|---|
| `Gym & Studio Training` | 22 | Leads with the differentiator no competitor owns — handling both. Avoids "Coach" entirely. |
| `Snap a Plan, Talk It Through` | 28 | Leads with the two mechanics — photo capture + conversation — over category words. |
| `Talk Through Every Set` | 23 | Purely the conversational hook, plainest option. |
| `Gym & Studio, One Coach` | 24 | Same idea as option 1, but reuses "Coach" from Name — some index value lost to overlap. |

Recommended:
```
Gym & Studio Training
```
22 chars. It's the one differentiator competitors can't copy overnight,
and it reads as fact rather than pitch — closer to the "plain,
matter-of-fact" voice rule than the conversational-hook options.

**Primary Category**
```
Health & Fitness
```

**Secondary Category** — pick one:
```
Lifestyle   ← recommended: picks up adjacent search traffic without
              fighting the exact same competitors twice
Sports
```

**Content Rights**
```
Does not contain, show, or access third-party content
```

---

## Previews and Screenshots — iPhone, 6.5" Display

0 of 10 uploaded — **this blocks submission**, do it before anything
else below. Only iPhone sizes needed (`supportsTablet: false` in
`app.json`, no iPad/Watch screenshots required). Check "View All Sizes
in Media Manager" before uploading — Apple periodically adds newer
required sizes (6.9" Pro Max) beyond the 6.5" shown here.

Per the ASO guide: real, unpolished UI screenshots outconvert
professionally designed ones, and you have 3-5 seconds to land the
first one before a scroll-past. Shot order:

1. **The AI coach mid-conversation, guiding a live set** — this is
   your actual differentiator vs. every generic logger. Lead with it,
   not a welcome screen.
2. Photo-to-plan or AI plan generation (`plan-photo.tsx` / `plan-generate.tsx`)
3. Studio AI-generated workout — rep ladders / station rounds (nothing
   else on the Store does this)
4. Progress / PR tracking screen
5. Persona customization

---

## Promotional Text (170 char limit)

The only field editable anytime without a new review — good for
seasonal/timely tweaks later.

```
A coach who talks you through every set — gym or studio. Photograph the board or your plan and it's ready before you've put your phone down. Remembers every rep.
```
161 chars. No pricing, no "AI-powered" lead, no trainer/medical
substitute claim.

---

## Description (4,000 char limit)

Only the first ~2-3 lines show before "more" — same 3-5-second rule as
screenshots applies to the opening line.

```
Notch is a coach you talk to.

Bring a plan, or photograph one — a printed program, even a whiteboard — and Notch turns it into a real, structured workout. From there, every session is a conversation. Notch tells you what's next, you do it, and you check back in. Only got 6 reps instead of 8? Just say so — it adjusts and keeps going.

It remembers everything, so you don't have to. Every weight, every set, every session, ready before you walk in.

Built for gym and studio training
Most apps handle one or the other. Notch handles both. Lifting sessions track weight and reps, the way you'd expect. Studio and functional classes get their own units — band colour, box height, metres, calories, reps per side, rep ladders across rounds — tracked the way your coach actually calls them out.

How it works
• Photograph a plan or a whiteboard — Notch reads it into a structured workout
• Talk through every set, in plain language — confirm it, correct it, or just tell it what happened
• Automatic progression, based on what you actually did last time
• Full studio support — bands, boxes, distance, calories, rounds, per-side reps
• Eight languages, including genuine right-to-left layouts for Hebrew and Arabic — the whole interface mirrors, not just the text

Never train alone again.

Terms of Use (EULA): https://web-dorhaimbob-webs-projects.vercel.app/terms
Privacy Policy: https://web-dorhaimbob-webs-projects.vercel.app/privacy
```
No pricing, no "AI-powered" lead, no trainer/medical substitute claim,
sentence case throughout. Closing line reuses your own screenshot
caption for consistency across the listing.

⚠️ The Terms/Privacy lines were added after Apple rejected build 31's
submission for missing a functional Terms of Use link in metadata
(subscriptions require one). Keep them in the Description going forward.

⚠️ "Eight languages" assumes `pt`/`fr`/`it` land before submission —
only `en`/`he`/`ar`/`de`/`es` exist in `apps/mobile/src/locales/` right
now. Confirm those three ship, or trim the count and the language list
in the last bullet before this goes live.

---

## Keywords (100 char limit)

Comma-separated, no spaces (saves characters), nothing already in
Name/Subtitle above — Apple's already indexed those words.

```
tracker,trainer,personal,crossfit,wod,functional,circuit,strength,lifting,barbell,rep,hiit,pr,log
```
97 chars. Leans into the CrossFit/functional angle, which the big
lifting-tracker apps (Strong, Hevy, JEFIT) mostly ignore — now that
Studio training is a headline feature, not a footnote, that's real
open ground.

⚠️ **This list depends on whatever you pick for Name/Subtitle above.**
None of these words collide with any of the 4 subtitle options, so
it's safe regardless of which you pick — but if you land on a
different Name alternate, recheck for overlap before locking in.

Also: add a localized keyword set for Hebrew (and Arabic, since both
are supported locales per `apps/mobile/src/locales/`) — the guide's
own data point is that secondary-language markets crack top-10 in
~6 months vs. ~1 year for the US, precisely because there's less
competition validating the same terms.

---

## What's New (beta build)

Not an ASC field on this PDF — lives in TestFlight's build notes. Kept
generic since I don't have a specific changelog to attribute to a
particular build; tell me which commits/features it should call out if
you want it more specific.

```
Welcome to Notch, early access.

You're one of the first people using this. It's not finished — some things will be rough, and that's exactly why you're here.

Talk to your coach through a full session and see how it feels. If something's wrong, confusing, or just doesn't work, tell us — every bit of feedback shapes what we build next.
```

---

## Support URL

```
https://web-dorhaimbob-webs-projects.vercel.app
```
Live (verified 200). Bare homepage right now, no dedicated support
content — fine to submit with, but worth adding a real `/support` page
with a contact email when you have a spare hour.

## Marketing URL

```
https://web-dorhaimbob-webs-projects.vercel.app
```

## Version

```
1.0
```

## Copyright

```
© 2026 Dor Haim Bobrutsky
```

## Routing App Coverage File

N/A — not a routing/navigation app. Leave blank.

---

## App Clip

N/A — no App Clip built. Leave collapsed.

## iMessage App

N/A. Leave collapsed.

## Build

Needs an EAS build uploaded before you can select one here. Per your
standing rule, I won't run `eas build`/`eas submit` without you
explicitly saying go.

## In-App Purchases and Subscriptions

Must be created and submitted alongside this version — ASC requires
the first IAP/subscription to ship with a version, can't be added
after. The app already has real monthly/annual products wired up
(`apps/mobile/app/subscribe.tsx`, fallback display prices `$9.99`/mo,
`$59.99`/yr via RevenueCat) — confirm those match what you actually
configure here.

**Subscription Group**
```
Reference Name: Notch Premium
```
One group, two products inside it (below) — this is what lets Apple
show them together as upgrade/downgrade options on the paywall.

**Product 1 — Monthly**
```
Reference Name:  Notch Monthly
Product ID:      com.dorbob.gymcoach.monthly   ← permanent, can't change later
Duration:        1 Month
Price:           $9.99 (USD) — accept Apple's auto-generated
                 per-territory equivalents, don't hand-tune
Tax Category:    Fitness and health
Availability:    All countries or regions
```
App Store Localization (English, U.S. — required first):
```
Display Name: Monthly
Description:  Unlimited AI-coached workouts, every set remembered.
```

**Product 2 — Annual**
```
Reference Name:  Notch Annual
Product ID:      com.dorbob.gymcoach.annual    ← permanent, can't change later
Duration:        1 Year
Price:           $59.99 (USD), same auto-territory-pricing rule as above
Tax Category:    Fitness and health
Availability:    All countries or regions
```
App Store Localization (English, U.S.):
```
Display Name: Annual
Description:  Save ~50% — unlimited AI-coached workouts, billed yearly.
```

Per-subscription **Review Information screenshot is REQUIRED** for a
first subscription submitted with a new app version — ASC will block
"Add for Review" without one (confirmed: `Unable to Add for Review —
You must add a Review Information screenshot`). Correction to what
this doc said before. Add the **same screenshot to both** Monthly and
Annual's Review Information section:

- Open the app → Settings → Subscription (routes to `/subscribe`) →
  screenshot that screen (shows both plans, prices, and the purchase
  button — exactly what App Review needs to see).
- **Same size requirements as the app's regular screenshots above** —
  per Apple's official IAP-info reference page, this field just needs
  to match any of your app's supported screenshot specs:
  `1242×2688`, `2688×1242`, `1284×2778`, or `2778×1284`. No special
  smaller size, no cropping needed — a raw device screenshot at (or
  resized to) one of those four sizes works as-is. (Earlier note about
  640×920 was wrong — that was from an outdated forum report, not the
  current official spec.)
- Upload it under each product's own Review Information → Screenshot.
- Notes field here can stay empty — the app-level Notes below already
  explain how to reach it.

**Availability must be explicitly saved**, not just left on its
default — if you hit the same "must set availability" error again
after this: open the subscription → Availability → confirm "All
Countries or Regions" is checked → make sure you hit Save/Next on
that specific screen (it doesn't count as set until that step is
its own confirmed action, separate from the price screen).

Optional next step, not blocking: add Hebrew/Arabic localizations for
both products too, matching the app's actual supported languages —
ask and I'll draft copy within the same 35/55-char limits.

## Game Center

N/A. Leave unchecked.

---

## App Review Information

**Sign-In Information**
```
Sign-in required: ✅ checked
Username: ios-review-7f2ka9@notch.app
Password: (anything — app has no password field; see Notes below)
```
Full detail on how this account works: `secrets/app-review-account.md`
(gitignored, not repeated here).

**Contact Information**
```
First name: Dor
Last name:  Haim Bobrutsky
Phone:      +972548835011
Email:      notch.app.support@gmail.com
```

---

## Notes (4,000 char limit)

```
This app uses passwordless sign-in (Sign in with Apple or email + one-time code). For review, enter ios-review-7f2ka9@notch.app in the email field and tap Continue — you'll be signed in immediately, no code required. This is a dedicated review account, exempted from the OTP requirement server-side; all other accounts go through the normal 6-digit email code flow.

SUBSCRIPTION: New accounts (including the review account above) get a 30-day free trial with full access, so the paywall won't appear naturally during a short review session — this is intentional, not a bug. To see and test the subscription screen directly at any time, go to Settings > Subscription. From there you can view both plans and complete a purchase (billed through the App Store sandbox in this review environment). Manual workout logging and full history remain accessible even without an active subscription.
```

## Attachment

Not needed — the Notes above fully explain the sign-in flow. Only add
one if you want to hand the reviewer a screenshot walkthrough.

---

## App Store Version Release

```
( ) Manually release this version          ← recommended
(•) Automatically release this version
( ) Automatically release this version after App Review, no earlier than
```
Switch to **Manually release** for a first launch — you want to choose
the exact moment it goes live (coordinate your own announcement, make
sure you're around for support) rather than have it flip live the
instant Apple approves it, possibly at 3am your time.

---

## Not on this PDF, but still blocks submission

### App Privacy questionnaire (separate ASC page — App Information → App Privacy)

GYM-41. Go through "Get Started" → for each data type below, answer
whether it's collected, and if so whether it's linked to identity and
what it's used for. **"Used for tracking" is No for every single one** —
this app has no cross-app/cross-site ad tracking (no ad SDK, no IDFA
usage anywhere in the code).

| Data type | Collected? | Linked to identity? | Purpose |
|---|---|---|---|
| Email Address | Yes | Yes | App Functionality |
| User ID | Yes | Yes | App Functionality |
| Fitness | Yes (sets/reps/weight/plans — the whole product) | Yes | App Functionality |
| Physical Address, Name, Phone | No | — | — |
| Health | **No** — declare weight/height/age under Fitness instead, not Health; nothing in the app is medical diagnosis/treatment | — | — |
| Photos or Videos | Yes — photographed plans/whiteboards sent to the backend for AI parsing (`studio-photo.tsx`, `plan-photo.tsx`) — declare even though not persisted long-term, "collected" per Apple's definition means processed at all | Yes | App Functionality |
| Other User Content | Yes — pasted plan text, coach persona/tone, notes | Yes | App Functionality |
| Purchase History | Yes (RevenueCat/subscription status, once live) | Yes | App Functionality |
| Crash Data | Yes (Sentry) | **No** — `sendDefaultPii: false` is explicitly set in both `app/_layout.tsx` and the edge functions' Sentry init, and no `Sentry.setUser()` call exists anywhere in the code | App Functionality (Diagnostics) |
| Performance Data | **No** — `tracesSampleRate: 0` everywhere, performance tracing is off | — | — |
| Product Interaction | Yes (PostHog — `workout_started` etc., see `analytics.ts`) | **No** — no autocapture, no session replay, no `identify()` call anywhere; PostHog gets an anonymous device ID only | Analytics |
| Precise/Coarse Location | No | — | — |
| Contacts | No | — | — |
| Browsing/Search History | No | — | — |
| Payment Info / Credit Info | No — handled entirely by Apple's StoreKit/App Store; the app and its servers never see card details | — | — |
| Sensitive Info (race, religion, orientation, etc.) | No | — | — |

Injury/limitation notes (onboarding "anything you should avoid") are
fitness-context data about the user's own training, not medical
diagnosis — covered under **Fitness**, not a separate Sensitive Info
declaration.

### Age Rating questionnaire (separate ASC page)

Based on what the app actually does, answers are almost all "None" (no
violence, gambling, mature/suggestive content; no unrestricted web
access; no user-generated content shared publicly between users — plan
text stays private to the account). No medical/treatment advice, just
fitness coaching → should land at **4+**.

### Privacy Policy URL (App Privacy page, not Support/Marketing URL)

```
https://web-dorhaimbob-webs-projects.vercel.app/privacy
```
Verified live.
