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

**Subtitle** (30 char limit)
```
Log Sets & Track Progress
```
26 chars. Deliberately shares zero words with the Name above — Apple
treats repeated words across Name+Subtitle as wasted space, since it's
already indexed once.

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
Your AI coach remembers every rep, set, and kg — and knows exactly when to push you further. Build a plan, start lifting, get real-time coaching on every set.
```

---

## Description (4,000 char limit)

Only the first ~2-3 lines show before "more" — same 3-5-second rule as
screenshots applies to the opening line.

```
Notch is the AI personal trainer that runs your workout with you — set by set, rep by rep.

No more guessing your last weight or losing your progress in a notes app. Notch remembers every set you've ever done and tells you exactly when to add weight, reps, or rest — so every session pushes you a little further than the last.

HOW IT WORKS
• Build your plan — write it yourself, generate one instantly with AI, or snap a photo of a printed program and Notch turns it into a real, trackable plan.
• Train with a coach, not a stopwatch — Notch guides you through every exercise, set, and rest period in natural conversation, adjusting in real time to how you're actually performing.
• Progressive overload, automatically — Notch tracks every rep and weight across sessions and nudges your loads up when you're ready.
• Studio: AI-generated workouts — describe what you want (a 20-minute upper-body burnout, a 5-round circuit, a rep-ladder finisher) and Notch builds it, including per-side reps and rep ladders most trackers can't handle.
• Track real progress — history, PRs, and trends in one place.
• Make it yours — customize your coach's persona and tone.

Built for lifters who already train — Notch removes the friction of logging and planning so you can focus on the work.

Sign in with Apple or email. Your data is private and yours.
```

---

## Keywords (100 char limit)

Comma-separated, no spaces (saves characters), nothing already in
Name/Subtitle above — Apple's already indexed those words.

```
tracker,trainer,personal,fitness,exercise,strength,lifting,rep,plan,hypertrophy,muscle,pr,routine
```
97 chars.

⚠️ **This list depends on whatever you pick for Name/Subtitle above.**
If you switch to one of the Name alternates (e.g. `AI Gym Coach -
Notch`), re-add `workout` here and drop something to make room — the
two fields are one keyword budget, not two.

Also: add a localized keyword set for Hebrew (and Arabic, since both
are supported locales per `apps/mobile/src/locales/`) — the guide's
own data point is that secondary-language markets crack top-10 in
~6 months vs. ~1 year for the US, precisely because there's less
competition validating the same terms.

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
Email:      dorhaimbob@gmail.com
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
