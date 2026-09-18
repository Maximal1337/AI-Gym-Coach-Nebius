# Notch × Nebius Hackathon — Decisions & Action Plan

> **Status:** Accepted v1.0 (2026-09-18) · **Last updated:** 2026-09-18 · **Owners:** TBD
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
- **Stage A (required):** NanoClaw "Coach chat" outside workouts, with Tavily search and personalization memory.
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
- The Tavily bonus prize requires a functional runtime call to the **Tavily API**.
- Judges must be able to access the working project **through the end of judging (2026-12-15)**.

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
| D-03 | Model: **NVIDIA Nemotron via Nebius Token Factory** for the NanoClaw agent and memory extraction | Confirmed | 2026-09-17 | Hackathon requirement |
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

---

## 5. Open decisions

| ID | Question | Owner | Due | Default if not decided |
|---|---|---|---|---|
| O-01 | Which member's Nebius account hosts the VM, and which provides Token Factory keys? | TBD | 2026-09-20 | VM on the account with AI Cloud credits; Token Factory keys from the other account |
| O-02 | Supabase project region → VM region | TBD | 2026-09-20 | `eu-north1` if latency to Supabase is acceptable (cheapest 2 vCPU preset) |
| O-03 | License: MIT or Apache-2.0 | TBD | 2026-09-20 | MIT |
| O-04 | Spike go/no-go thresholds | TBD | 2026-09-23 | Chat p95 ≤ 10 s; ≤ 1 GiB RAM per container; ≤ $0.05 per 10-turn conversation |
| O-05 | How NanoClaw reaches Token Factory | Spike (NH-22) | 2026-09-30 | OpenCode provider with a custom OpenAI-compatible endpoint; fallback: Claude provider + Anthropic-compatible proxy |
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

**Available credits (≈ $200 in total):**
- Nebius Builder Program, per member and non-transferable: up to $50 AI Cloud + $50 Token Factory ($25 each at verification, $25 each ~30 days later). Credits expire 90 days after issuance.
- Hackathon promo code: $25 Token Factory per member.
- Tavily: Builder Program partner credits.

**Estimates:**

| Item | Sizing | Estimate |
|---|---|---|
| Nebius VM (NanoClaw host) | 2 vCPU / 8 GiB CPU VM ($0.012/vCPU-h + $0.0032/GiB-h ≈ $0.05/h), ~Oct 1 → Dec 15 | ≈ $90 compute + ≈ $5–10 disk (public IP: verify) |
| Token Factory | Nemotron 3 Super ($0.30 in / $0.90 out per 1M tokens) for development, evals, demo, judging, and the nightly memory job for demo accounts | ≈ $60–80; depends on harness tokens per turn (measured in NH-25) |
| Tavily | Builder Program credits + free tier | ≈ $0 |
| Gemini via OpenRouter | Unchanged | Current spend |

**Guardrails:**
- Run the NanoClaw spike locally (WSL2 + Docker Desktop) before provisioning the VM.
- Separate Token Factory API keys for the agent and the memory job, if supported, so spend per component is visible.
- Billing alerts; a global daily spend cap; per-account message caps for demo and judge accounts; a kill-switch flag.
- If credits run low: move extraction and simple turns to Nemotron 3.5 Lightning ($0.06 / $0.24 per 1M tokens), after an eval.
- A 4 vCPU / 16 GiB VM (≈ $72/month) does not fit the budget.

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
| M2 | NanoClaw spike go/no-go | 2026-09-30 | NH-20 … NH-27 | 18 |
| M3 | Nebius VM | 2026-10-03 | NH-30 … NH-35 | 14 |
| M4 | Coach template and tools | 2026-10-07 | NH-40 … NH-45 | 19 |
| M5 | Channel and delivery | 2026-10-09 | NH-50 … NH-57 | 27 |
| M6 | Personalization memory | 2026-10-12 | NH-60 … NH-66 | 18 (+5 stretch) |
| M7 | TestFlight demo build | 2026-10-14 (build submitted to Beta App Review by 10-12) | NH-70 … NH-73 | 12 |
| M8 | Stretch: in-workout coaching on NanoClaw | 2026-10-21 | NH-80 … NH-82 | 16 (stretch) |
| M9 | Submission | 2026-10-26 (hard deadline 2026-10-30 10:00 PT) | NH-90 … NH-93 | 9 |
| M10 | Judging support | 2026-12-15 | NH-95 | 1 |

Required scope: **146 points ≈ 50 person-days** on the §8 scale. Stretch: 21 points.

If capacity is lower, cut in this order:
1. M8
2. NH-66
3. NH-65 (replace with manual checks)
4. NH-08
5. NH-34 (provider snapshots only)
6. NH-35 (billing alerts and an uptime ping only)

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

- [ ] Additive migration `user_flags(user_id, flag, enabled, updated_at)`; users can read their own flags, only the service role writes
- [ ] Helper `isFlagEnabled(db, userId, flag)` in `supabase/functions/_shared/assistant.ts`
- [ ] Flags defined: `assistant_chat`, `assistant_memory`, `assistant_workout`, plus a global `assistant_enabled` kill switch
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

#### NH-14 · Fix message-length drift in coach-turn
**Priority:** Medium · **Estimate:** 1 · **Labels:** Area/Backend, Type/Bug · **Blocked by:** —

`coach-turn` rejects user messages longer than 200 characters, while the agent schema accepts up to 2000.

- [ ] One agreed limit applied in `supabase/functions/coach-turn/index.ts` and `services/agent/src/schema.ts`
- [ ] Verified with the `verify` skill and a live smoke test; deployed

#### NH-15 · Remove dead code
**Priority:** Low · **Estimate:** 1 · **Labels:** Area/Backend, Area/Agent, Type/Chore · **Blocked by:** —

- [ ] `coach-note` Edge Function removed from the repo and undeployed (no client calls it; notes are saved through the agent)
- [ ] Unused `buildOrchestrationIntroPrompt` (`services/agent/src/prompt.ts`) and `services/agent/src/llm-smoke.ts` removed
- [ ] Typecheck green

### M2 — NanoClaw spike go/no-go · target 2026-09-30

#### NH-20 · Agree spike go/no-go thresholds
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** —

- [ ] O-04 resolved; thresholds for latency, RAM per container and cost per conversation recorded in §5

#### NH-21 · Install a NanoClaw fork locally
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** —

- [ ] Fork created in the team's GitHub organization; NanoClaw version pinned
- [ ] Runs on WSL2 + Docker Desktop; a test agent group replies through the CLI channel
- [ ] NanoClaw license checked for the fork

#### NH-22 · Connect Nemotron via Nebius Token Factory
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-01, NH-21

- [ ] Actual model IDs listed via `GET https://api.tokenfactory.nebius.com/v1/models`
- [ ] Agent replies with Nemotron 3 Super through OpenCode using a custom OpenAI-compatible provider; fallback (Claude provider + Anthropic-compatible proxy) documented if needed
- [ ] Tool calling works end to end (an MCP tool is called and its result used in the reply)
- [ ] O-05 resolved

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
- [ ] Cost per 10-turn conversation estimated
- [ ] Sample replies in Hebrew, Arabic and Portuguese collected (informational)

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

#### NH-44 · Stage A write tool: save note
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-42

- [ ] `save_note` writes to `coach_notes` (general or exercise-scoped) with the same validation as the current coach
- [ ] Length limits enforced

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

- [ ] Global `assistant_enabled` flag turns the assistant off for everyone
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
**Priority:** Low · **Estimate:** 5 · **Labels:** Area/Agent, Type/Feature, Stretch · **Blocked by:** NH-55, NH-64

- [ ] NanoClaw scheduled task (paused in the template, enabled for demo accounts) sends a daily message with today's workout and one relevant fact
- [ ] Delivered through `assistant-deliver` with a push notification; within spend caps

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
- [ ] How NanoClaw, Nemotron on Token Factory and Tavily are used
- [ ] Section "What changed during the submission period (after 2026-08-26)"
- [ ] License and demo instructions

#### NH-91 · Demo video
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** NH-73

- [ ] Under 3 minutes, uploaded to YouTube
- [ ] Shows the Coach chat, a Tavily answer with sources, memory (facts screen and a personalized reply), and the isolation/security story

#### NH-92 · Make the repositories public
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Security, Area/Docs, Type/Chore · **Blocked by:** NH-04, NH-05, NH-06

- [ ] Notch repo and NanoClaw fork (with template and adapter) public
- [ ] Final secret scan clean; branch protection enabled on `main`

#### NH-93 · Devpost submission
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** NH-72, NH-90, NH-91, NH-92

- [ ] Description covers features, NVIDIA model usage and the Nebius tools used
- [ ] Track: Personal AI; repo and video links; TestFlight link and demo credentials in the testing instructions
- [ ] Nebius feedback form completed
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
| AI Cloud credits don't cover the VM through Dec 15 | Demo offline during judging | 2 vCPU / 8 GiB from Oct 1; billing alerts; stop the VM in November only as a last resort | NH-01, NH-30, NH-95 |
| Harness tokens per turn higher than expected | Token Factory credits run out | Measure in the spike; daily caps; Nemotron 3.5 Lightning fallback | NH-25, NH-51 |
| Public repo and judge accounts invite abuse | Spend spikes | Allowlists from secrets, per-account and global caps, kill switch | NH-06, NH-51, NH-57 |
| Prompt injection or memory poisoning | Data leakage, bad advice | Agent group per user, no `agent-browser`, search-only Tavily, egress allowlist, server-side validation | NH-26, NH-32, NH-45 |
| Changes to shared code break the current coach for real users | Outage for real users | D-17; additive migrations; `verify` skill and live smoke tests | NH-14 |
| Spike is a no-go (latency, cost or tool calling) | Stage A at risk | Decide by Sep 30; fallback to a smaller model, fewer tools or reduced scope | NH-27 |
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
