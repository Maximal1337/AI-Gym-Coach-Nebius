---
name: app-store-connect-revenuecat-setup
description: Set up or troubleshoot App Store Connect subscription products and their RevenueCat integration for Notch — category/tax category selection, review screenshot format, the two different Apple API key types RevenueCat needs, and RevenueCat's Test Store vs. real App Store products distinction. Use when creating/editing subscription products in App Store Connect, connecting or debugging the RevenueCat↔App Store Connect link, or diagnosing a RevenueCat "Missing Metadata," "permission denied," or "incorrect size" error.
---

# App Store Connect + RevenueCat setup gotchas

Collected from actually doing this end to end for Notch's $9.99/mo,
$59.99/yr subscriptions — several of these contradict generic advice
findable online (including advice given earlier in the same session,
corrected once checked against Apple's real docs or real dashboard
behavior). Verify against the current live screen before trusting any of
this blindly if Apple's UI has since changed.

## App Information (not the version page)

- **Primary Category: Health & Fitness** — confirmed against Apple's
  official category list (`developer.apple.com/app-store/categories`), not
  a guess. Its own description ("healthy living, fitness, workout
  tracking") is a direct match.
- **Tax Category** (per-subscription, not per-app): **"Fitness and
  health"** — confirmed against Apple's official
  `set-a-tax-category` help doc. A generic label like "App Store In-App
  Purchases and Subscriptions" is **not** a real category name; don't
  invent one from memory.

## Subscription hierarchy — two different "Reference Name" prompts

A **Subscription Group** (its own Reference Name, asked once when the
group is created) contains multiple individual **Subscriptions**, each
with its **own separate** Reference Name, Product ID, Duration, Price,
Availability, Tax Category, and Localization. Easy to conflate the two
prompts — if you're asked for a name right after "which group," you're
naming the group; if it's after picking Duration/Price, you're naming the
individual product.

**Product ID is permanent** — can never be changed or reused once created,
especially once anyone's purchased it. Convention: bundle ID + suffix
(`com.dorbob.gymcoach.monthly`).

## Availability needs an explicit save, not just a checked box

Checking "All Countries or Regions" alone does not persist by itself —
there's a separate confirm/Next action on that specific screen that has to
be completed, or ASC will later report "you must set availability" even
though the box looked checked. If "Add for Review" fails with that error
after you thought this was done, redo it for **every** product (Monthly
*and* Annual each have their own) and make sure you click through to the
end of that flow, not just toggle the checkbox.

## Review Information screenshot is REQUIRED for a first submission

Contrary to it being described as optional: for a subscription submitted
alongside a **new** app version (i.e. the first one ever), App Store
Connect blocks "Add for Review" with `You must add a Review Information
screenshot` if it's missing. Add the same screenshot to both Monthly and
Annual's own Review Information section (they're independent fields).

**Correct format**: same as the app's regular listing screenshots —
`1242×2688`, `2688×1242`, `1284×2778`, or `2778×1284`. **Not** a special
640×920 size (that's stale advice from an old forum thread; Apple's
current official `in-app-purchase-information` reference page explicitly
says to use the app's normal supported screenshot specs). A raw device
screenshot resized to one of those four exact sizes works as-is, no
special cropping needed.

## "Missing Metadata" in RevenueCat ≈ Apple's "Prepare for Submission"

If a product shows `MISSING_METADATA` in RevenueCat's Products list after
importing, but every field visually looks filled in when you check it in
ASC — per Apple's own IAP-statuses reference doc, "Prepare for Submission"
means *"created, but you haven't yet submitted it for review... if
missing required metadata, complete it before adding for review."* In
practice this often just means the subscription hasn't been formally
attached to an "Add for Review" submission yet (which itself needs a real
build uploaded first) — not that something you filled in is actually
wrong. Don't chase this status further if everything checks out visually;
it should clear once you actually submit alongside a build.

## RevenueCat needs TWO different Apple API keys, from TWO different places

Both live under App Store Connect → **Users and Access → Integrations**,
but in different spots — easy to generate the wrong one first (happened
this session):

| Key type | Where in ASC | File name | Role | What it's for |
|---|---|---|---|---|
| **In-App Purchase Key** | Integrations page, **sidebar** under "Keys" → "In-App Purchase" (easy to miss, it's not a top-level tab) | `SubscriptionKey_XXXX.p8` | Account Holder or Admin | Reading subscription/transaction status — required for RevenueCat's basic ASC connection to work at all |
| **App Store Connect API key** | Integrations → **"App Store Connect API"** tab → Team Keys | `AuthKey_XXXX.p8` | App Manager | Specifically enables the **Import** products button and automatic price-change syncing — RevenueCat's connection form has a *second*, separate upload field for this one |

Both `.p8` files can only be downloaded **once** — grab them the moment
they appear, or you have to revoke and regenerate.

## RevenueCat's quickstart creates fake Test Store products first

The onboarding wizard (before you've connected ASC) creates placeholder
products under a **"Test Store"** group — a fake in-memory sandbox, not
real Apple products. Don't wire an Offering's packages to these long-term.
After ASC is actually connected: go to **Products** → your real
**"[App Name] (App Store)"** group → click **Import** (not "New" — avoids
retyping IDs by hand) to pull in the real subscriptions you created in
ASC. Then, in the **Offering**, repoint each package at the imported real
product instead of the Test Store one — packages can hold one product per
store, so it's fine to leave the Test Store product attached alongside the
real App Store one (useful for SDK testing without needing a sandbox
tester account).

**Package identifiers must be RevenueCat's exact predefined strings**,
`$rc_monthly` / `$rc_annual` — this app's code (`subscribe.tsx`) filters
`offering.availablePackages` by `packageType === 'MONTHLY' | 'ANNUAL'`,
which RevenueCat only derives correctly from those specific identifiers,
not an arbitrary custom one.

## Entitlement name must exactly match the app's code, not sound branded

The quickstart wizard only offers a few AI-suggested, branded-sounding
names ("X Pro", "X Premium", "X Unlimited") with no visible text field —
tap **"Other"** to get free text input. Enter the app's actual
`ENTITLEMENT_ID` constant exactly (case-sensitive) — for Notch, `premium`
— not a marketing-sounding name. This string is never shown to users, so
there's no reason to make it presentable.
