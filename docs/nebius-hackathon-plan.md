# Notch × Nebius Hackathon — Decisions & Action Plan

> **Status:** Accepted v1.1 — revised 2026-09-23 against the event briefing · **Last updated:** 2026-09-23 · **Owners:** TBD
> **Track:** Personal AI · **Submission deadline:** 2026-10-30 10:00 PT · **Judging:** 2026-12-01 → 2026-12-15
> **Tracking:** Linear — see [§8 Linear setup](#8-linear-setup)

How to use this document:
- §4 Decisions is the source of truth. When a decision changes, update it there first.
- §10 lists every issue in a Linear-ready format (title, priority, estimate, labels, blockers, acceptance criteria).
- `NH-xx` / `PH-xx` are placeholder IDs. Once the issues exist in Linear, put the Linear key next to each.

---

## Contents

1. [Summary](#1-summary)
2. [Hackathon constraints](#2-hackathon-constraints)
3. [Current architecture](#3-current-architecture)
4. [Decisions](#4-decisions)
5. [Open decisions](#5-open-decisions)
6. [Target architecture](#6-target-architecture)
7. [Budget](#7-budget)
8. [Linear setup](#8-linear-setup)
9. [Milestones and timeline](#9-milestones-and-timeline)
10. [Issues by milestone](#10-issues-by-milestone)
11. [Risks](#11-risks)
12. [Post-hackathon backlog](#12-post-hackathon-backlog)
13. [References](#13-references)

---

## 1. Summary

Notch gets a personal AI coach:
- **Runtime:** NanoClaw on a Nebius VM.
- **Model:** NVIDIA Nemotron via Nebius Token Factory.
- **Web search:** Tavily.
- **Memory:** the coach remembers facts about the user; a nightly job keeps the list up to date.

The existing stack stays in place during the hackathon: Supabase, the Fly.io agent service and the Vercel landing page. New features are enabled only for team, demo and judge accounts via server-side feature flags. All real users keep the current experience until a post-hackathon rollout.

What we submit:
- **Stage A (required):** NanoClaw "Coach chat" outside workouts, with Tavily search, personalization memory, write tools so the assistant acts on the user's behalf, and a proactive daily check-in.
- **Stage B (stretch):** in-workout coaching on NanoClaw.
- **Submission package:** public repo with an OSS license, English README, demo video under 3 minutes, TestFlight link with demo accounts.

---

## 2. Hackathon constraints

Source: [Nebius x NVIDIA Global AI Hackathon rules](https://nebiusglobalaihackathon.devpost.com/rules)

- The project makes runtime calls to **Nebius Token Factory** (or runs on Nebius AI Cloud).
- It uses **at least one NVIDIA open model** (Nemotron family).
- The repository is **public** with an open-source license (Apache 2.0, MIT or MPL 2.0).
- Submission includes an English README with setup instructions, a demo video under 3 minutes, and a working demo or test build that judges can access.
- For a pre-existing project, the submission explains what was **significantly updated after 2026-08-26**.
- The Tavily bonus prize requires a functional runtime call to the **Tavily API**. A project can win one overall **or** one track award, plus at most one bonus.
- Judges must be able to access the working project **through the end of judging (2026-12-15)**, free of charge; if it's gated, the submission provides a login.
- The demo video is public on YouTube, under 3 minutes, with a **voiceover that explains how Token Factory and Nemotron are used**, and no third-party music or trademarks.
- The license must be visible in GitHub's **About** panel, and the README must explain how Nemotron and Token Factory are used.
- The submission selects the **Tel Aviv** city (City Winner) and includes feedback on Token Factory, AI Cloud and the NVIDIA tools.
- Judging stage 1 is pass/fail on track fit and on **not being a superficial rebrand** of an open-source base. Stage 2 scores four criteria equally: technical implementation (how effectively Token Factory and Nemotron are used), design as a whole product, impact, and quality of idea.
- The Personal AI track's judging hint: not a chatbot with a system prompt, but an assistant that **remembers across sessions and acts on the user's behalf**.
- NanoClaw, NemoClaw and Tavily are **optional**; only the Nebius runtime call and the NVIDIA open model are mandatory.

---

## 3. Current architecture

As of 2026-09-17:

| Component | Runs on | Notes |
|---|---|---|
| Database | Supabase Postgres | 26 migrations, RLS on every table |
| Auth | Supabase Auth | Email OTP, Sign in with Apple |
| API layer | Supabase Edge Functions (Deno) | 12 functions + `_shared/mod.ts` (workout orchestration, rate limits, entitlement, usage accounting) |
| LLM agent service | Fly.io app `gymcoach-agent` (fra) | `services/agent`; OpenRouter → Gemini 3.1 Flash-Lite; called only by Edge Functions with a shared secret |
| Landing & legal pages | Vercel | `apps/web` (Next.js) |
| iOS app | App Store (EAS builds) | Reads its own rows directly via RLS; mutations go through Edge Functions |
| Third-party services | RevenueCat, Expo Push, Sentry, PostHog, Apple | RevenueCat webhook → Supabase Edge Function |

---

## 4. Decisions

| ID | Decision | Status | Date | Rationale |
|---|---|---|---|---|
| D-01 | Compete in the **Personal AI** track | Confirmed | 2026-09-17 | A private assistant with persistent memory matches the track |
| D-02 | Agent runtime: **NanoClaw** ([nanoclaw.dev](https://nanoclaw.dev)) | Confirmed | 2026-09-17 | Container isolation per agent, custom channels, templates, Tavily integration |
| D-03 | Model: **NVIDIA Nemotron via Nebius Token Factory**, routed per purpose — Super for interactive turns with `reasoning_effort: "none"`, Ultra with thinking on for the nightly memory job, Nano/Lightning for cheap classification | Confirmed; routing proposed | 2026-09-23 | Hackathon requirement. Thinking must be off on tool-calling turns: a reasoning model can spend `max_tokens` on thinking and return empty `content` |
| D-04 | Web search: **Tavily**, search only (`tavily_search`) | Confirmed | 2026-09-17 | Bonus prize; replaces generic web tools; extract is an exfiltration risk |
| D-05 | **Keep Supabase** (Postgres, Auth, Edge Functions), the Fly.io agent service and Vercel; full infra migration deferred | Confirmed | 2026-09-17 | Migration cost doesn't fit the hackathon timeline |
| D-06 | Auth stays on **Supabase Auth**; no custom auth service | Confirmed | 2026-09-17 | Ready-made and already in production |
| D-07 | New features only for **team/demo/judge accounts** via server-side flags; all real users keep the current coach until after the hackathon | Confirmed | 2026-09-17 | No risk to real users during development |
| D-08 | Staged delivery: **Stage A required**, **Stage B stretch** | Confirmed | 2026-09-17 | Keeps the in-workout path stable |
| D-09 | Plan parsing and plan generation stay on **Gemini (OpenRouter)** | Confirmed | 2026-09-17 | Gemini reads PDFs and photos natively; Nemotron is text-only |
| D-10 | The repository becomes **public** with an OSS license | Confirmed | 2026-09-17 | Hackathon requirement |
| D-11 | Personalization: **typed facts, score computed in code**, max 15 facts per user | Confirmed | 2026-09-17 | LLM-assigned numeric scores drift between runs |
| D-12 | Document storage: **JSONB tables in Supabase**; no MongoDB | Proposed | 2026-09-17 | Supabase has no separate NoSQL store; JSONB gives document flexibility without new infrastructure |
| D-13 | **One NanoClaw agent group per user** | Proposed | 2026-09-17 | NanoClaw docs: sessions within one agent group are not a confidentiality boundary (shared files and memory) |
| D-14 | The NanoClaw host **pulls** work from Supabase; the VM accepts no inbound traffic except SSH | Proposed | 2026-09-17 | Authentication of NanoClaw's inbound webhooks is not documented |
| D-15 | Nebius VM **2 vCPU / 8 GiB**, running ~2026-10-01 → 2026-12-15; the spike runs locally on WSL2 | Proposed | 2026-09-17 | Fits AI Cloud credits (§7) |
| D-16 | Judges test via a **public TestFlight link + seeded demo accounts** (one per judge) | Proposed | 2026-09-17 | The App Store version for real users stays unchanged |
| D-17 | During the hackathon, existing coaching functions and the behavior of `_shared/mod.ts` do not change (NH-14 excepted). New code lives in new functions and `_shared/assistant.ts`; `mod.ts` may only gain new exports. Migrations are additive only | Proposed | 2026-09-17 | Protects real users |
| D-18 | Work is tracked in **Linear** (§8) | Confirmed | 2026-09-17 | Team workflow |
| D-19 | NanoClaw is the **runtime, not the product**. The deliverable is our own software on top: the MCP tool server over real training data, the memory pipeline, per-user provisioning and the channel adapter, and the deterministic progression the agent must obey. README and video lead with those | Confirmed | 2026-09-23 | Stage 1 rejects a superficial rebrand of an open-source base; "deploy NanoClaw + Nemotron + Tavily" is configuration, not a project |
| D-20 | How NanoClaw reaches Token Factory, in this order: (1) a LiteLLM container exposing an Anthropic-compatible endpoint, with NanoClaw's built-in Claude provider pointed at it via `ANTHROPIC_BASE_URL`; (2) patch the OpenCode provider in our fork; (3) drop NanoClaw from the realtime path and keep our own agent loop | Confirmed | 2026-09-23 | NanoClaw issue #1984 (open, no maintainer reply): routing OpenCode/Codex at a custom OpenAI-compatible endpoint needs patched provider source, while `ANTHROPIC_BASE_URL` is a documented path |
| D-21 | The assistant must **act**, not just answer: Stage A ships write tools (save a note, adjust an exercise in the plan) and the proactive daily check-in is required, not a stretch | Confirmed | 2026-09-23 | The Personal AI judging hint is explicitly about memory across sessions plus acting on the user's behalf |
| D-22 | Write scope (resolves O-08): without a confirmation step the assistant may save a note and swap or replace **one exercise in one active plan**. Everything else — creating or archiving plans, bulk edits, touching history, account or subscription settings — stays out of Stage A. Every write is recorded in `assistant_actions` and reversible with an `undo_last_change` tool for 24 hours, and the reply states exactly what changed | Confirmed | 2026-09-23 | A "are you sure?" round trip defeats the point of an assistant that acts; an audit trail plus undo gives the same safety without it, and doubles as the trust story in the demo |
| D-23 | The nightly memory job stays on **Supabase Cron + an Edge Function**. A Nebius Serverless Job only if the job outgrows Edge Function time limits | Confirmed | 2026-09-23 | Nebius is already used honestly twice — Token Factory for inference, an AI Cloud VM for the agent runtime. A Serverless Job purely to name a third service is box-ticking, and it would add an image build, secrets and scheduling for no product gain |
| D-24 | Both members have event credits, so: the VM runs on member A's AI Cloud credits, the agent uses member A's Token Factory key, and the nightly memory job uses member B's key | Confirmed | 2026-09-23 | Credits are non-transferable; separate keys double the usable Token Factory budget and make spend per component visible |

---

## 5. Open decisions

| ID | Question | Owner | Due | Default if not decided |
|---|---|---|---|---|
| O-01 | Which member is "A" in D-24 (hosts the VM and the agent key)? | TBD | 2026-09-30 | Whoever will operate the VM day to day |
| O-02 | Supabase project region → VM region | TBD | 2026-09-20 | `eu-north1` if latency to Supabase is acceptable (cheapest 2 vCPU preset) |
| O-03 | License: MIT or Apache-2.0 | TBD | 2026-09-20 | MIT |
| O-04 | Spike go/no-go thresholds | TBD | 2026-09-23 | Chat p95 ≤ 10 s; ≤ 1 GiB RAM per container; ≤ $0.05 per 10-turn conversation |
| O-05 | How NanoClaw reaches Token Factory | Spike (NH-22) | 2026-09-30 | Resolved into D-20's three-step order; the spike picks the first step that works |
| O-06 | Owner per milestone | TBD | 2026-09-20 | — |
| O-07 | Git history contains personal data (the creator's phone number and personal email, in `app-store-connect-form.md` and older landing pages). How do we publish? | Creator | Before NH-92 | Publish a **new** public repository from a filtered copy of the history (`git filter-repo --replace-text`, commit dates kept) and keep the current repository private. A force-push alone doesn't clean GitHub's `refs/pull/*` for already-merged PRs |

---

## 6. Target architecture

```
iOS app (TestFlight build) ──JWT──► Supabase Edge Functions ──► Supabase Postgres (+ Queues, Cron)
                                      ├─ assistant-send    (auth, flag, rate limit, spend caps)
                                      ├─ assistant-outbox  (adapter pulls work)          ◄──┐
                                      ├─ assistant-deliver (HMAC, store reply, push)     ◄──┤ outbound
                                      ├─ notch-tools MCP   (per-user token)              ◄──┤ HTTPS only
                                      └─ memory-nightly    (Cron 00:00 UTC → Token Factory)
                                                                                            │
Nebius VM (2 vCPU / 8 GiB) ── NanoClaw host (systemd, non-root) ── Notch channel adapter ───┘
   ├─ OneCLI Agent Vault: Token Factory key, Tavily key, per-user tool tokens
   └─ one agent group per user; one container per active session
        └─► egress allowlist: Token Factory (Nemotron), Tavily, Supabase

Unchanged for real users: services/agent on Fly.io (Gemini) — current workout coach,
plan parsing and generation
```

Invariants:
- Supabase is the source of truth. The agent never holds database credentials.
- Every write goes through `notch-tools`, which validates it against the database (same rule as today's coach).
- Numbers shown in the UI (targets, progress) come from server-side tool results, never from agent prose.
- One agent group per user (D-13).
- The VM accepts no inbound traffic except SSH (D-14).
- D-17 applies to all changes in `supabase/`.

---

## 7. Budget

**Available credits (per attending member, non-transferable):**
- Builders & Brews Tel Aviv event: **$100 Token Factory + $100 AI Cloud**, plus Tavily credits.
- Hackathon promo code `NEBIUS-DEVPOST-GLOBAL26`: **+$25 Token Factory**.
- Nebius Builders Program (dev.nebius.com/builders): **+$25 Token Factory**, plus Tavily credits and Academy access.
- Roughly **$150 Token Factory + $100 AI Cloud** per member. Credits expire 90 days after issuance, so check the dates still cover judging through 2026-12-15, and note which account holds which pot (O-01).

**Estimates:**

| Item | Sizing | Estimate |
|---|---|---|
| Nebius VM (NanoClaw host) | 2 vCPU / 8 GiB CPU VM ($0.012/vCPU-h + $0.0032/GiB-h ≈ $0.05/h), ~Oct 1 → Dec 15 | ≈ $90 compute + ≈ $5–10 disk (public IP: verify) |
| Token Factory | Nemotron 3 Super ($0.30 in / $0.90 out per 1M) for interactive turns, Ultra ($1 / $3 per 1M) for the nightly memory job, Lightning ($0.06 / $0.24) for cheap calls — development, evals, demo and judging | ≈ $60–90; depends on harness tokens per turn (measured in NH-25) |
| Tavily | Builder Program credits + free tier | ≈ $0 |
| Gemini via OpenRouter | Unchanged | Current spend |

**Guardrails:**
- Run the NanoClaw spike locally (WSL2 + Docker Desktop) before provisioning the VM.
- Two Token Factory keys from the two members' accounts (D-24): the agent on member A's, the nightly memory job on member B's. That doubles the usable budget and makes spend per component visible.
- Billing alerts; a global daily spend cap; per-account message caps for demo and judge accounts; a kill-switch flag.
- If credits run low: move extraction and simple turns to Nemotron 3.5 Lightning ($0.06 / $0.24 per 1M tokens), after an eval.
- A 4 vCPU / 16 GiB VM (≈ $72/month) now fits within one member's $100 AI Cloud credits for the final stretch — worth it only if the spike shows memory pressure from concurrent agent containers plus the LiteLLM proxy (D-20).

---

## 8. Linear setup

**Team:** the existing Notch team. Code comments already reference `GYM-` issue keys.

**Projects:**
- **Notch × Nebius Hackathon** — target date 2026-10-30; milestones M0–M10 (§9); issues NH-01 … NH-95 (§10).
- **Notch — Post-hackathon** — backlog PH-01 … PH-11 (§12).

**Label groups:**
- `Area`: Backend (Supabase), Agent (NanoClaw), Mobile, Infra (Nebius), Memory, Security, Docs, QA
- `Type`: Feature, Spike, Chore, Bug
- `Stretch` (standalone label)

**Priority:**
- Urgent: blocks other work or is deadline-critical
- High: required for submission
- Medium: should do
- Low: stretch or nice-to-have

**Estimates (points):** 1 = up to 2 h · 2 = half a day · 3 = 1 day · 5 = 2–3 days · 8 = up to a week

**Relations:** add a "blocked by" relation for every entry in an issue's **Blocked by** field.

**Cycles:** 1-week cycles aligned with §9.

**Workflow:** Backlog → Todo → In Progress → In Review → Done

**GitHub integration:**
- Create branches from the Linear issue.
- Include the issue key in PR titles.
- Use `Fixes GYM-123` in the PR description to auto-close the issue.

**Definition of Done:**
- Acceptance criteria met.
- Typecheck and tests green.
- Supabase and mobile changes verified with the repo's `verify` skill (bundle compile, `deno check`, live smoke test).
- No secrets in code.
- §4 updated if a decision changed.

---

## 9. Milestones and timeline

| ID | Milestone | Target date | Issues | Points |
|---|---|---|---|---|
| M0 | Credits, compliance, safety net | 2026-09-20 | NH-01 … NH-08 | 14 |
| M1 | Foundations | 2026-09-24 | NH-10 … NH-15 | 14 |
| M2 | NanoClaw spike go/no-go | 2026-09-30 | NH-20 … NH-28 | 20 |
| M3 | Nebius VM | 2026-10-03 | NH-30 … NH-35 | 14 |
| M4 | Coach template and tools | 2026-10-07 | NH-40 … NH-45 | 22 |
| M5 | Channel and delivery | 2026-10-09 | NH-50 … NH-57 | 27 |
| M6 | Personalization memory | 2026-10-12 | NH-60 … NH-66 | 23 |
| M7 | TestFlight demo build | 2026-10-14 (build submitted to Beta App Review by 10-12) | NH-70 … NH-73 | 12 |
| M8 | Stretch: in-workout coaching on NanoClaw | 2026-10-21 | NH-80 … NH-82 | 16 (stretch) |
| M9 | Submission | 2026-10-26 (hard deadline 2026-10-30 10:00 PT) | NH-90 … NH-93 | 9 |
| M10 | Judging support | 2026-12-15 | NH-95 | 1 |

Required scope: **156 points ≈ 55 person-days** on the §8 scale. Stretch: 16 points.

If capacity is lower, cut in this order:
1. M8
2. NH-65 (replace with manual checks)
3. NH-08
4. NH-34 (provider snapshots only)
5. NH-35 (billing alerts and an uptime ping only)

Don't cut NH-66 or NH-44 to save time: without them the submission is a chatbot, which is what the track's judging hint rules out (D-21).

Never cut: NH-05, NH-06, NH-26, NH-31, NH-32.

| Week | Dates | Focus |
|---|---|---|
| 1 | Sep 17–23 | M0, M1, local spike starts |
| 2 | Sep 24–30 | M1 wrap-up, M2 go/no-go |
| 3 | Oct 1–7 | M3 (VM), M4 |
| 4 | Oct 8–14 | M5, M6, M7 (TestFlight submitted by Oct 12) |
| 5 | Oct 15–21 | Demo polish, M8 stretch |
| 6 | Oct 22–30 | M9: video, README, submission (target Oct 26) |
| — | Dec 1–15 | M10: judging, stack frozen and monitored |

---

## 10. Issues by milestone

### M0 — Credits, compliance, safety net · target 2026-09-20

#### NH-01 · Join Nebius Builder Program and redeem hackathon credits
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** —

Both members join the Nebius Builder Program and redeem the hackathon Token Factory codes.

- [ ] AI Cloud and Token Factory credits are visible in both accounts
- [ ] O-01 decided and recorded in §5
- [ ] Billing alerts configured on both accounts
- [ ] Credit issue dates recorded so expiry can be tracked through 2026-12-15

#### NH-02 · Register the team on Devpost and confirm eligibility
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** —

- [ ] Team registered; Personal AI track noted
- [ ] Every member confirmed eligible under the official rules
- [ ] Key dates added to the Linear project (submission 2026-10-30 10:00 PT; judging 2026-12-01 → 12-15)

#### NH-03 · Claim Tavily credits and create an API key
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Agent, Type/Chore · **Blocked by:** —

- [ ] API key created and stored in the team password manager, never in the repo
- [ ] Available credits and limits noted in §7

#### NH-04 · Choose and add a root LICENSE
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** O-03

- [ ] License agreed by both members (O-03)
- [ ] `LICENSE` at the repo root with the correct copyright holders
- [ ] `apps/mobile/LICENSE` (Expo template) reviewed: keep, replace or remove

#### NH-05 · Scan the full git history for secrets
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Security, Type/Chore · **Blocked by:** —

Run gitleaks (or equivalent) across all branches and the full history before the repo goes public.

- [ ] Scan report attached to the issue
- [ ] Every finding rotated or confirmed as non-secret
- [ ] Scan added to the pre-publish checklist (NH-92)

**Findings (2026-09-18):** a local pattern scan of all refs found no API keys, tokens, JWTs or private keys, and no `.env` file was ever committed. The history does contain personal data → O-07. It also contains the old test and review sign-in addresses; those become harmless once NH-06 rotates them. `.github/workflows/secret-scan.yml` runs gitleaks over the full history; run it manually right before NH-92.

#### NH-06 · Move test and review account allowlists out of code; rotate the review account
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Backend, Area/Security, Type/Chore · **Blocked by:** —

Two places hardcode account emails that allow instant sign-in without a one-time code: `supabase/functions/dev-test-login/index.ts` and the `dev_test_reset_account` SQL function. Once the repo is public, anyone could use them.

- [ ] Allowlist comes from Supabase secrets (function) and a table with no client access (SQL function), not from code
- [ ] New test and App Store review accounts created; the old addresses are rejected by `dev-test-login`
- [ ] App Review information in App Store Connect updated with the new review account
- [ ] Additive migration only; verified with a live smoke test
- [ ] No test or review address left in the repo: `sign-in.tsx`, `.claude/skills/*`, and `app-store-connect-form.md` (also holds the creator's name and phone — move it to the git-ignored `secrets/` folder)

#### NH-07 · CI: run unit tests
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/QA, Type/Chore · **Blocked by:** —

`.github/workflows/ci.yml` currently runs only `pnpm typecheck`.

- [ ] CI runs the `services/agent` tests (`src/*.test.ts`) and the mobile tests (`src/lib/*.test.ts`)
- [ ] A failing test fails the workflow

#### NH-08 · CI: `deno check` for Edge Functions and locale validation
**Priority:** Medium · **Estimate:** 3 · **Labels:** Area/QA, Type/Chore · **Blocked by:** —

- [ ] `deno check` runs for every function against a recorded baseline of known errors; new errors fail CI
- [ ] All 8 locale JSON files validated

### M1 — Foundations · target 2026-09-24

#### NH-10 · Per-user feature flags
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** —

- [ ] Additive migration: `feature_flags(flag, enabled, …)` (one global switch per flag) and `user_flags(user_id, flag, enabled, updated_at)`; clients read their own effective flags via `my_feature_flags()` and never write
- [ ] Helper `isFlagEnabled(db, userId, flag)` in `supabase/functions/_shared/assistant.ts`, failing closed
- [ ] Flags defined: `assistant_chat`, `assistant_memory`, `assistant_workout`. A flag is on only when its global switch and the user's row are both on, so the global switch is the kill switch
- [ ] Only team and demo accounts have flags enabled

#### NH-11 · Shared config for new Edge Functions
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/Backend, Type/Chore · **Blocked by:** —

- [ ] `_shared/assistant.ts` holds rate limits, per-account and global daily caps, supported languages and allowed CORS origins for the new functions
- [ ] Existing `_shared/mod.ts` behavior unchanged (D-17)

#### NH-12 · Mobile: read flags and gate new screens
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Mobile, Type/Feature · **Blocked by:** NH-10

- [ ] Flags loaded after sign-in and cached for the session
- [ ] New entry points hidden unless the corresponding flag is on
- [ ] Full Metro bundle compiles (`verify` skill)

#### NH-13 · Seeded demo and judge accounts
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Backend, Area/QA, Type/Feature · **Blocked by:** NH-06, NH-10

Memory only shows up with history, so demo accounts need realistic data. Follow the repo's `dev-test-scenario-accounts` skill.

- [ ] One team demo account plus five judge accounts (one per judge), with instant login from the secret allowlist
- [ ] Each account seeded with a coach profile, active plans, ~2 weeks of workouts and chat messages
- [ ] Facts seeded once NH-60 lands
- [ ] Flags enabled only for these accounts; per-account daily caps apply

**Implementation (2026-09-18):** migration `20260918140000_demo_accounts.sql` adds `private.demo_accounts` (the registry) and `private.seed_demo_account(email)`. The `private` schema isn't exposed through the API, so the seed runs only from the SQL editor or `supabase db query`. It seeds an English persona: Upper/Lower plan, 8 workouts / 128 sets whose weights follow `progression.ts`, 32 workout-chat messages rich in personal context for the memory job, 2 saved notes and both assistant flags. It refuses unregistered and QA-scenario addresses because it wipes the account first. Re-run it right before judging. Runbook: `dev-test-scenario-accounts` skill, "Demo and judge accounts". Facts get added to the seed with NH-60.

#### NH-14 · Fix message-length drift in coach-turn
**Priority:** Medium · **Estimate:** 1 · **Labels:** Area/Backend, Type/Bug · **Blocked by:** —

`coach-turn` rejects user messages longer than 200 characters, while the agent schema accepts up to 2000.

- [ ] One agreed limit applied in `supabase/functions/coach-turn/index.ts` and `services/agent/src/schema.ts`
- [ ] Verified with the `verify` skill and a live smoke test; deployed

**Resolution (2026-09-18):** no user-facing drift. The app's composer already caps input at 200 characters (`maxLength` in `apps/mobile/app/(tabs)/train.tsx`), matching `coach-turn`; the agent's 2000 is only a looser outer bound. No code change; close as won't fix.

#### NH-15 · Remove dead code
**Priority:** Low · **Estimate:** 1 · **Labels:** Area/Backend, Area/Agent, Type/Chore · **Blocked by:** —

- [ ] `coach-note` Edge Function removed from the repo and undeployed (no client calls it; notes are saved through the agent)
- [ ] Unused `buildOrchestrationIntroPrompt` (`services/agent/src/prompt.ts`) and `services/agent/src/llm-smoke.ts` removed
- [ ] Typecheck green

### M2 — NanoClaw spike go/no-go · target 2026-09-30

#### NH-28 · Raw Token Factory smoke test: Nemotron tool calling
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-01

Runs **first**, before any NanoClaw wiring, so a model problem can't be mistaken for a harness problem. Two known failure modes to rule out: a reasoning model spending `max_tokens` on thinking and returning empty `content`, and tool calls breaking on reasoning models.

- [ ] `GET /v1/models` lists the Nemotron IDs we plan to use (Super, Ultra, Nano/Lightning)
- [ ] A full two-step tool call (request → `tool_calls` → tool result → final answer) succeeds on the interactive model with `reasoning_effort: "none"`
- [ ] `tool_choice: "required"` and a `response_format: json_schema` call both succeed — the memory job depends on schema output
- [ ] Recorded per model: latency, tokens, and whether `reasoning_content` ever arrives instead of `content`
- [ ] If every Nemotron fails at tool calling: decide between a translation layer (LiteLLM), a different Nemotron variant, or keeping tool calling in our own loop, and ask in the Nebius Discord

#### NH-20 · Agree spike go/no-go thresholds
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** —

- [ ] O-04 resolved; thresholds for latency, RAM per container and cost per conversation recorded in §5

#### NH-21 · Install a NanoClaw fork locally
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** —

- [ ] Fork created in the team's GitHub organization; NanoClaw version pinned
- [ ] Runs on WSL2 + Docker Desktop; a test agent group replies through the CLI channel
- [ ] NanoClaw license checked for the fork

#### NH-22 · Connect Nemotron via Nebius Token Factory
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-21, NH-28

Work D-20's order and stop at the first step that works. Step 1 is the documented path on both sides; NanoClaw issue #1984 is why step 2 exists.

- [ ] Step 1: a LiteLLM container exposes an Anthropic-compatible endpoint over Token Factory, and NanoClaw's Claude provider reaches it via `ANTHROPIC_BASE_URL` with the real key held in the vault
- [ ] Step 2 if step 1 fails: patch the OpenCode provider in our fork to accept a custom OpenAI-compatible base URL
- [ ] The agent answers with Nemotron and calls an MCP tool end to end (the tool's result is used in the reply)
- [ ] Interactive turns run with thinking off; the setting that achieves it is written down
- [ ] Confirmed that nothing silently falls back to Claude at runtime — the requests reach Token Factory
- [ ] O-05 resolved and recorded in §4

#### NH-23 · Tavily search via MCP
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-03, NH-21

- [ ] `/add-tavily-tool` installed with the API key in the OneCLI vault
- [ ] Only `tavily_search` exposed; `tavily_extract` disabled
- [ ] A test question produces an answer that cites its sources

#### NH-24 · Prototype a pull-based channel adapter
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-21

- [ ] Adapter implements NanoClaw's `ChannelAdapter` contract, polls a mock outbox and calls `onInbound`
- [ ] `deliver()` posts replies to a mock endpoint
- [ ] Full round trip works for one test user

#### NH-25 · Measure latency, tokens, RAM and concurrency
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-22, NH-24

- [ ] Cold start and p50/p95 reply latency recorded
- [ ] Input/output tokens per turn recorded; source of usage data identified (agent runner, `outbound.db`, vault gateway or Token Factory key)
- [ ] RAM per container recorded with 3 concurrent sessions
- [ ] Cost per 10-turn conversation estimated, at the routing from D-03
- [ ] Sample replies in Hebrew, Arabic and Portuguese collected (informational)
- [ ] Confirmed over a longer session that `content` is never empty because of reasoning (the NH-28 failure mode, but through the harness)

#### NH-26 · Verify NanoClaw security controls
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Security, Type/Spike · **Blocked by:** NH-21

- [ ] Egress lockdown tested; a way to allow only Token Factory, Tavily and Supabase confirmed
- [ ] Built-in `agent-browser` skill removed from the agent group and confirmed unavailable
- [ ] Agent memory write behavior documented
- [ ] Per-group vault secrets that share one host pattern confirmed working

#### NH-27 · Go/no-go review
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-20, NH-23, NH-25, NH-26

- [ ] Measurements compared with the thresholds; decision recorded in §4
- [ ] If no-go: fallback agreed (smaller model, fewer tools, or reduced Stage A scope)

### M3 — Nebius VM · target 2026-10-03

#### NH-30 · Provision the Nebius VM
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-01, NH-27

- [ ] 2 vCPU / 8 GiB CPU VM with Ubuntu LTS in the region from O-02
- [ ] Docker Engine installed; dedicated non-root service user
- [ ] Hourly cost checked against §7

#### NH-31 · Harden the VM
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Infra, Area/Security, Type/Chore · **Blocked by:** NH-30

- [ ] SSH with keys only, restricted source IPs, password login disabled
- [ ] No inbound ports other than SSH
- [ ] fail2ban and unattended security upgrades enabled

#### NH-32 · Egress allowlist
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Security, Type/Chore · **Blocked by:** NH-26, NH-30

- [ ] `NANOCLAW_EGRESS_LOCKDOWN=true`
- [ ] Host firewall (`DOCKER-USER` chain) allows only Token Factory, Tavily and the Supabase project
- [ ] A request from an agent container to any other host fails (tested)

#### NH-33 · Run NanoClaw on the VM
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-30

- [ ] Fork installed as a systemd user service with `Restart=always`; version pinned
- [ ] `CONTAINER_MEMORY_LIMIT=1g`, `CONTAINER_CPU_LIMIT=1` and `CONTAINER_PIDS_LIMIT` set
- [ ] Hardened (Echo) images used if available
- [ ] Service comes back after a VM reboot

#### NH-34 · Backups and restore drill
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-33

- [ ] Scheduled disk snapshots, or backups of NanoClaw `data/` and `groups/`
- [ ] Restore tested once on a fresh disk or VM

#### NH-35 · Monitoring and alerts
**Priority:** Medium · **Estimate:** 3 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-33

- [ ] Uptime check and host health (CPU, RAM, disk) with alerts
- [ ] Running container count and adapter errors visible
- [ ] Nebius billing alerts verified

### M4 — Coach template and tools · target 2026-10-07

#### NH-40 · `notch/coach` NanoClaw template
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-27

- [ ] Agent Plugins 1.0.0 template with persona and rules ported from `services/agent/src/prompt.ts` (safety rules, formatting, reply language)
- [ ] MCP servers: `notch-tools` and Tavily; `agent-browser` removed; no active scheduled tasks
- [ ] `ncl groups create --template notch/coach` produces a working agent group

#### NH-41 · `assistant_agents` mapping and tool tokens
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** —

- [ ] Additive migration `assistant_agents(user_id, agent_group_id, token_hash, created_at)` with no client access
- [ ] Helper resolves a bearer token to a `user_id` by hash comparison; tokens never grant database access

#### NH-42 · `notch-tools` MCP Edge Function skeleton
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-10, NH-11, NH-41

- [ ] Streamable HTTP MCP server running as a Supabase Edge Function
- [ ] Every call resolves the token to a user, checks flags, entitlement (`subscriptionAccess`) and rate limits
- [ ] Tool errors return safe messages: no stack traces, no secrets
- [ ] A test tool is callable from the local NanoClaw spike

#### NH-43 · Stage A read tools
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-42

- [ ] Tools: `get_profile`, `get_active_plans` (with exercises), `get_workout_history` (recent sessions and progression summary), `get_user_facts`
- [ ] Every query filtered by the resolved `user_id`
- [ ] Weights returned in the user's unit system

#### NH-44 · Stage A write tools: save note, plan tweak, undo
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-42

D-21: acting on the user's behalf is what the track is judged on, so Stage A isn't read-only. D-22 keeps that safe without a confirmation round trip: act now, record it, allow undo.

- [ ] `save_note` writes to `coach_notes` (general or exercise-scoped) with the same validation as the current coach; length limits enforced
- [ ] `adjust_plan_exercise` swaps or replaces one exercise in one active plan through the existing validated write path; sets, reps and rest carry over unless the user named new ones
- [ ] Additive migration `assistant_actions(id, user_id, kind, before jsonb, after jsonb, created_at, undone_at)`; every write tool records one row
- [ ] `undo_last_change` reverts the user's most recent action within 24 hours and is itself recorded
- [ ] Tools refuse anything outside D-22's scope, re-check ownership server-side, and the reply states exactly what changed and that it can be undone

#### NH-45 · Agent instructions and policies
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-40

- [ ] `user_facts` is canonical memory: the agent does not store personal facts in NanoClaw's own memory
- [ ] Tavily only for knowledge questions (nutrition labels, exercise substitutions, equipment), no personal data in queries, sources cited
- [ ] Medical safety rule preserved: pain or injury → stop the exercise and consult a professional

### M5 — Channel and delivery · target 2026-10-09

#### NH-50 · Assistant message store and inbound queue
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** —

- [ ] Additive migration `assistant_messages(id, user_id, role, doc jsonb, created_at)`; users can read their own rows via RLS
- [ ] Inbound work queue (Supabase Queues/pgmq or a table) with lease and ack
- [ ] Deleting a user removes their rows from both

#### NH-51 · `assistant-send` Edge Function
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-10, NH-11, NH-50

- [ ] JWT auth, flag check, rate limit, per-account and global daily caps
- [ ] Idempotency key: a retried send never duplicates a message
- [ ] Stores the user message and enqueues work

#### NH-52 · `assistant-outbox` Edge Function
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-50

- [ ] Shared-secret auth, usable only by the adapter
- [ ] Returns pending work under a lease; ack endpoint; expired leases return to the queue

#### NH-53 · `assistant-deliver` Edge Function
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-50

- [ ] HMAC-verified requests with replay protection (timestamp + dedup)
- [ ] Stores the reply in `assistant_messages` and sends a push notification

#### NH-54 · Notch channel adapter
**Priority:** Urgent · **Estimate:** 5 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-24, NH-52, NH-53

- [ ] Polls `assistant-outbox` and calls `onInbound(platformId = userId)`; `deliver()` posts to `assistant-deliver`
- [ ] At most 3 active containers; extra work waits in the queue; idle containers are stopped
- [ ] Recovers from network errors; deployed on the VM (NH-33)

#### NH-55 · Provisioning on first message
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-40, NH-41, NH-54

- [ ] Unknown user → `ncl groups create --template notch/coach`; provider and model set; vault secrets granted; messaging group wired with sender policy `strict`, the user registered as member, session mode `shared`
- [ ] Mapping stored in `assistant_agents`
- [ ] Idempotent: a retry never creates a second agent group

#### NH-56 · Account deletion cleanup
**Priority:** Medium · **Estimate:** 3 · **Labels:** Area/Backend, Area/Agent, Type/Feature · **Blocked by:** NH-55

- [ ] Deleting an account removes the user's agent group, its workspace and vault secret
- [ ] The user's database rows are removed by cascade (`assistant_messages` via NH-50, `user_facts` and `user_memory_state` via NH-60)
- [ ] `assistant_agents` mapping row removed

#### NH-57 · Kill switch and usage queries
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-51

- [ ] Kill switch tested: `update public.feature_flags set enabled = false where flag like 'assistant_%'` hides the assistant for everyone
- [ ] Saved SQL queries: messages per day, tokens and spend per day, errors per day

### M6 — Personalization memory · target 2026-10-12

#### NH-60 · Facts tables
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Memory, Type/Feature · **Blocked by:** —

- [ ] Additive migration `user_facts(id, user_id, doc jsonb, score, pinned, created_at, updated_at)`; `doc` holds `text, category, importance, stability, evidence, expires_at, first_seen_at, last_seen_at, mention_count, source_message_ids`
- [ ] Additive migration `user_memory_state(user_id, facts_version, last_run_at, watermark)`
- [ ] RLS: users can read and delete their own facts; deleting a fact bumps `facts_version` (trigger)
- [ ] Rows in both tables cascade-delete with the user

#### NH-61 · Fact extraction on Nemotron
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Memory, Type/Feature · **Blocked by:** NH-22

- [ ] Prompt and JSON schema: input is current facts + new messages; output is a list of operations `ADD | UPDATE(id) | REINFORCE(id) | CONTRADICT(id) | EXPIRE(id)` with `category`, `importance` (1–5), `stability` (temporary / long-term / permanent), `evidence` (explicit / inferred)
- [ ] Invalid JSON or unknown fact IDs are rejected, never applied
- [ ] Facts stored as short neutral statements (≤ 140 characters) that never contain instructions

#### NH-62 · Scoring and eviction module
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Memory, Type/Feature · **Blocked by:** —

Score is computed in code, never by the LLM:
- `score = (importance / 5) × category_weight × confidence × recency + reinforcement`
- `category_weight`: health/injury 1.5 · goal 1.2 · schedule/equipment 1.0 · preference 0.9 · other 0.7
- `confidence`: explicit 1.0 · inferred 0.6
- `recency = 0.5 ^ (days_since_last_seen / half_life)`; `half_life`: temporary 7 days · long-term 60 days · permanent → no decay
- `reinforcement = min(0.3, 0.1 × log2(1 + mention_count))`

Eviction, with a cap of 15 facts per user:
1. Remove expired facts.
2. Fewer than 15 facts → insert.
3. Otherwise insert only if the new fact scores higher than the lowest-scoring unpinned fact; that fact is evicted.
4. Health/injury facts are pinned (max 3) until contradicted or expired.

- [ ] Pure module with unit tests for every rule and boundary (15th and 16th fact, pinned limit, expiry, ties)
- [ ] Deterministic: the same input always gives the same output

#### NH-63 · Nightly memory job
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Memory, Type/Feature · **Blocked by:** NH-60, NH-61, NH-62

- [ ] Supabase Cron at 00:00 UTC queues flagged users with new messages since their watermark; sources: `assistant_messages` and workout `messages` from the last 14 days
- [ ] Worker Edge Function processes users in batches that fit Edge Function time limits
- [ ] Applies NH-61 operations through NH-62; bumps `facts_version` on any change; advances the watermark
- [ ] Idempotent (re-running a batch changes nothing); retries with backoff; per-user token cap; run summary logged
- [ ] Runs on member B's Token Factory key (D-24) with Ultra and thinking on, since nothing here is latency-sensitive
- [ ] Stays on Supabase Cron per D-23; record the measured batch duration so "it outgrew the Edge Function limit" stays a checkable trigger

#### NH-64 · Facts injection into the agent
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Memory, Area/Agent, Type/Feature · **Blocked by:** NH-54, NH-63

- [ ] The adapter attaches the facts block when `facts_version` changes and on every new container spawn
- [ ] Block explicitly marked as data, never instructions; at most 15 lines
- [ ] The agent's reply references a relevant fact in a scripted test

#### NH-65 · Memory evaluation
**Priority:** Medium · **Estimate:** 3 · **Labels:** Area/Memory, Area/QA, Type/Feature · **Blocked by:** NH-63

- [ ] Golden set of at least 10 English chats with expected facts; precision and recall recorded
- [ ] Running the job twice on unchanged input changes nothing

#### NH-66 · Proactive daily check-in
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-55, NH-64

Required, not a stretch (D-21): "always-on" is half of what the Personal AI track asks for, and a message the user didn't trigger is the clearest demo of it.

- [ ] NanoClaw scheduled task (paused in the template, enabled per account) sends a daily message with today's workout and one relevant fact
- [ ] Delivered through `assistant-deliver` with a push notification; within spend caps
- [ ] Skips silently when there's nothing to say, so it never becomes noise

### M7 — TestFlight demo build · target 2026-10-14

#### NH-70 · Mobile: Coach chat screen
**Priority:** Urgent · **Estimate:** 5 · **Labels:** Area/Mobile, Type/Feature · **Blocked by:** NH-12, NH-51, NH-53

- [ ] Sends through `assistant-send` and renders `assistant_messages`, with pending and typing states
- [ ] Catches up on missed replies when the app returns to the foreground or a push is tapped (same pattern as the workout chat)
- [ ] Clear states for rate limit, daily cap reached and assistant disabled
- [ ] New strings added to all 8 locale files (English fallback is acceptable for the demo)

#### NH-71 · Mobile: "What the coach remembers" screen
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Mobile, Type/Feature · **Blocked by:** NH-12, NH-60

- [ ] Lists facts with their category; the user can delete any fact
- [ ] Empty state when there are no facts

#### NH-72 · TestFlight build and public link
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Mobile, Type/Chore · **Blocked by:** NH-70, NH-71

EAS build and submit commands need explicit team approval and `--non-interactive` (see `apps/mobile/AGENTS.md`).

- [ ] Build submitted to Beta App Review for external testing by 2026-10-12
- [ ] Public TestFlight link created
- [ ] App Store version for real users unchanged
- [ ] Build expiry (90 days) covers judging through 2026-12-15

#### NH-73 · End-to-end demo run
**Priority:** High · **Estimate:** 2 · **Labels:** Area/QA, Type/Chore · **Blocked by:** NH-13, NH-33, NH-55, NH-64, NH-72

- [ ] Checklist passes on the TestFlight build with a judge account:
  - sign in
  - Coach chat
  - Tavily answer with sources
  - personalized reply using facts
  - delete a fact
  - push notification received
- [ ] Every issue found is filed in Linear

### M8 — Stretch: in-workout coaching on NanoClaw · target 2026-10-21

#### NH-80 · Stage B write tools
**Priority:** Low · **Estimate:** 8 · **Labels:** Area/Backend, Type/Feature, Stretch · **Blocked by:** NH-43

- [ ] Tools: start session, log sets, correct a set, defer / switch / substitute exercise, complete session
- [ ] Reuse the existing orchestration and deterministic progression through new exports only (D-17)
- [ ] Every write validated against the database; structured UI state (targets, progress, next exercise) returned

#### NH-81 · Parity eval against the current coach
**Priority:** Low · **Estimate:** 5 · **Labels:** Area/Agent, Area/QA, Type/Feature, Stretch · **Blocked by:** NH-80

- [ ] English regression cases ported from the few-shot examples in `services/agent/src/converse.ts`, plus scenarios for set logging, corrections, switch and defer
- [ ] Database effects and replies compared with the current `/converse` path; pass rate recorded

#### NH-82 · Container pre-warm and gated rollout to demo accounts
**Priority:** Low · **Estimate:** 3 · **Labels:** Area/Agent, Type/Feature, Stretch · **Blocked by:** NH-81

- [ ] The user's container is pre-warmed when a workout starts
- [ ] `assistant_workout` flag enabled for demo accounts only after latency and cost gates pass
- [ ] Falls back to the current coach when the flag is off or NanoClaw is unavailable

### M9 — Submission · target 2026-10-26 (hard deadline 2026-10-30 10:00 PT)

#### NH-90 · English README
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** —

- [ ] Architecture diagram and a component overview
- [ ] Setup instructions for the mobile app, Supabase functions, agent service, NanoClaw fork and template, and the VM, with every environment variable listed
- [ ] How NanoClaw, Nemotron on Token Factory and Tavily are used, including the model routing and why each model is used where
- [ ] A clear split of what comes from upstream NanoClaw and what we wrote (D-19), with the fork's license preserved
- [ ] Section "What changed during the submission period (after 2026-08-26)"
- [ ] License and demo instructions

#### NH-91 · Demo video
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** NH-73

- [ ] Under 3 minutes, public on YouTube, no third-party music or trademarks
- [ ] Voiceover explicitly explains how Token Factory and the Nemotron models are used (a scored requirement, not a nicety)
- [ ] Shows memory across sessions and the assistant acting — a proactive check-in and a tool-driven change — not just chat
- [ ] Shows a Tavily answer with sources, and names what is ours versus upstream NanoClaw (D-19)

#### NH-92 · Make the repositories public
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Security, Area/Docs, Type/Chore · **Blocked by:** NH-04, NH-05, NH-06

- [ ] Notch repo and NanoClaw fork (with template and adapter) public
- [ ] Final secret scan clean; branch protection enabled on `main`

#### NH-93 · Devpost submission
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** NH-72, NH-90, NH-91, NH-92

- [ ] Description covers features, NVIDIA model usage and the Nebius tools used
- [ ] Track: Personal AI; city: **Tel Aviv** (City Winner); repo and video links; TestFlight link and demo credentials in the testing instructions
- [ ] License visible in the repository's GitHub **About** panel
- [ ] Feedback on Token Factory, AI Cloud and the NVIDIA tools submitted
- [ ] Submitted by 2026-10-26

### M10 — Judging support · 2026-12-01 → 2026-12-15

#### NH-95 · Keep the demo alive through judging
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-93

- [ ] Weekly check from 2026-10-30 to 2026-12-15: VM up, TestFlight build valid, credits balance and expiry, spend within caps
- [ ] Deploy freeze from 2026-12-01 to 2026-12-15; incident contact assigned

---

## 11. Risks

| Risk | Impact | Mitigation | Related |
|---|---|---|---|
| AI Cloud credits don't cover the VM through Dec 15 | Demo offline during judging | ~$100 AI Cloud per member covers a 2 vCPU / 8 GiB VM from Oct 1 with headroom; billing alerts; watch the 90-day credit expiry | NH-01, NH-30, NH-95 |
| Harness tokens per turn higher than expected | Token Factory credits run out | Measure in the spike; daily caps; Nemotron 3.5 Lightning fallback | NH-25, NH-51 |
| Public repo and judge accounts invite abuse | Spend spikes | Allowlists from secrets, per-account and global caps, kill switch | NH-06, NH-51, NH-57 |
| Prompt injection or memory poisoning | Data leakage, bad advice | Agent group per user, no `agent-browser`, search-only Tavily, egress allowlist, server-side validation | NH-26, NH-32, NH-45 |
| The assistant makes a change the user didn't want | Lost trust, damaged training plan | D-22's narrow write scope, the `assistant_actions` audit trail and `undo_last_change`; the reply always states what changed | NH-44 |
| Changes to shared code break the current coach for real users | Outage for real users | D-17; additive migrations; `verify` skill and live smoke tests | NH-14 |
| Spike is a no-go (latency, cost or tool calling) | Stage A at risk | Decide by Sep 30; fallback to a smaller model, fewer tools or reduced scope | NH-27 |
| Stage 1 rejects the entry as a superficial rebrand | Never reaches scoring | D-19: our tools, memory, provisioning and adapter are the deliverable, and the README and video lead with them rather than with NanoClaw | NH-90, NH-91 |
| Nemotron returns reasoning instead of content, or breaks on tool calls | The assistant can't act at all | NH-28 before any wiring; `reasoning_effort: "none"` on interactive turns; LiteLLM translation or a different Nemotron as fallback | NH-28, NH-22 |
| NanoClaw can't reach a custom OpenAI-compatible endpoint (issue #1984, open) | Runtime blocked | D-20's three steps, decided by Sep 30; step 1 uses documented paths on both sides | NH-22, NH-27 |
| The runtime quietly falls back to Claude | Disqualifying: no Nebius runtime call | Assert in NH-22 that requests reach Token Factory; check again after every NanoClaw upgrade | NH-22, NH-33 |
| Beta App Review delay; judges without an iPhone | Judges can't test | Submit the build by Oct 12; video and screenshots in the README | NH-72, NH-91 |
| NanoClaw upgrade breaks the custom adapter | Assistant unavailable | Pinned version, fork, staged upgrades | NH-21, NH-33 |
| Nemotron reply quality in Hebrew, Arabic, Portuguese | Poor replies for those users after rollout | Demo in English; quality gate before rollout | PH-04 |
| Scope exceeds team capacity | Missed deadline | Cut order in §9 | — |

---

## 12. Post-hackathon backlog

Linear project **Notch — Post-hackathon**.

| ID | Issue | Priority |
|---|---|---|
| PH-01 | Update the privacy policy: Nebius, Tavily, assistant memory including health-related facts | High |
| PH-02 | Re-consent when the terms version changes (today only the presence of consent is checked) | High |
| PH-03 | Disclose third-party AI data sharing for App Review; release the assistant in an App Store build | High |
| PH-04 | Quality gate for Hebrew, Arabic and Portuguese replies on Nemotron, or route those languages to another Token Factory model | High |
| PH-05 | Roll out assistant features to all users: flag ramp, monitoring, capacity and budget review | High |
| PH-06 | `services/agent`: one OpenAI-compatible LLM client, env-based model names and price table; remove raw OpenRouter fetches and hardcoded model names | Medium |
| PH-07 | Evaluate moving plan parsing and generation to Token Factory (vision model, PDF text extraction) | Medium |
| PH-08 | Mobile: move hardcoded URLs (web URL, store URL, platform) into config | Low |
| PH-09 | Split `_shared/mod.ts` into infrastructure and domain modules; reduce per-turn query fan-out | Medium |
| PH-10 | Shared API contracts (zod) across mobile, Edge Functions and the agent | Medium |
| PH-11 | Re-evaluate full infrastructure migration to Nebius (gateway, domain, Postgres, auth) | Low |

---

## 13. References

- Hackathon: [rules](https://nebiusglobalaihackathon.devpost.com/rules) · [resources](https://nebiusglobalaihackathon.devpost.com/resources)
- NanoClaw: [site](https://nanoclaw.dev) · [docs](https://docs.nanoclaw.dev)
- NanoClaw docs:
  - [architecture](https://docs.nanoclaw.dev/concepts/architecture.md) · [entity model](https://docs.nanoclaw.dev/concepts/entity-model.md) · [isolation levels](https://docs.nanoclaw.dev/concepts/isolation-levels.md) · [agent memory](https://docs.nanoclaw.dev/concepts/agent-memory.md)
  - [channel adapter interface](https://docs.nanoclaw.dev/reference/adapter-interface.md) · [agent providers](https://docs.nanoclaw.dev/extend/providers.md) · [tools and Tavily](https://docs.nanoclaw.dev/extend/tools.md) · [templates](https://docs.nanoclaw.dev/templates/using-templates.md)
  - [hardening](https://docs.nanoclaw.dev/operate/hardening.md) · [credentials (OneCLI vault)](https://docs.nanoclaw.dev/operate/credentials.md) · [container lifecycle](https://docs.nanoclaw.dev/concepts/container-lifecycle.md) · [installation](https://docs.nanoclaw.dev/installation.md)
- Nebius: [Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart) · [Compute pricing](https://docs.nebius.com/compute/resources/pricing) · [Builder Program terms](https://nebius.com/builders-terms-and-conditions)
- NVIDIA: [Nemotron 3 Super model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8)
- Context for D-12: [Supabase + FerretDB (MongoDB compatibility)](https://supabase.com/blog/nosql-mongodb-compatibility-with-ferretdb-and-flydotio)
