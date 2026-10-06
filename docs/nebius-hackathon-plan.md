# Notch × Nebius Hackathon — Decisions & Action Plan

> **Status:** Accepted v1.2 — revised 2026-09-27: runtime moved to OpenShell + Hermes, infrastructure on k3s with Argo CD, budget held inside the credits · **Last updated:** 2026-10-01 · **Owners:** @Maximal1337, @dorhaimbob-web
> **Track:** Personal AI · **Submission deadline:** 2026-10-30 10:00 PT · **Judging:** 2026-12-01 → 2026-12-15
> **Tracking:** Linear — see [§8 Linear setup](#8-linear-setup)

How to use this document:
- §4 Decisions is the source of truth. When a decision changes, update it there first.
- §10 lists every issue in a Linear-ready format (title, priority, estimate, labels, blockers, acceptance criteria).
- `NH-xx` / `PH-xx` are placeholder IDs. Once the issues exist in Linear, put the Linear key next to each.

---

## 0. Status — 2026-09-27

**What changed in v1.2:**
- **Runtime:** NVIDIA OpenShell + Hermes Agent instead of NanoClaw (D-25). NanoClaw isn't in the hackathon's materials; OpenShell, Hermes Agent and NemoClaw are named as the Personal AI track's suggested tools.
- **Isolation:** every user gets their own sandbox with their own Hermes (D-26). No shared spaces, ever — when capacity runs out, requests wait in a queue.
- **Infrastructure:** one Nebius VPS running a single-node k3s with Argo CD, OpenShell installed through Helm, and `notch-dev` / `notch-prod` namespaces (D-31, D-32). Nothing agent-related is installed on a laptop; everything is Linux (D-33).
- **Budget:** no out-of-pocket spend. The VPS moves between the two members' AI Cloud credits on 2026-11-15 (D-31), and Token Factory spend has hard daily ceilings (D-34).
- **Decisions and open questions closed:** §4 and §5. Scope: the full plan, with the risk of not finishing everything accepted by the team (§9).

**Done and committed** (not deployed anywhere yet):
- M1 in full: feature flags (`feature_flags` / `user_flags`, `my_feature_flags()`, `isFlagEnabled`), `_shared/assistant.ts`, the app's `FlagsProvider`, dead code removed. NH-14 closed as won't-fix: the composer already caps input at 200 characters.
- NH-13: `private.seed_demo_account()` seeds two weeks of realistic history whose weights follow `progression.ts`.
- M0 partly: LICENSE (MIT, "The Notch authors"), gitleaks in CI, CI running tests, locale checks and `deno check` against a baseline, the instant-sign-in allowlist moved out of the repo into a secret.
- All migrations and the seed verified end to end against a real Postgres 17 (PGlite) — 29 migrations apply, 38 checks pass.
- 2026-09-28, local code, not deployed: migrations for the coach chat, the job queue, the action trail and the facts (NH-41, NH-50, NH-60, the `assistant_actions` table from NH-44), verified on PGlite with 81 checks including account-deletion cascades; the scoring and eviction module NH-62 with 26 Deno tests, now run in CI; the D-34 spend ceilings and ledger (NH-38) with 16 more tests and the Monday [budget runbook](./budget-runbook.md); `notch-tools` (NH-42) with its MCP core and HTTP boundary under 34 more tests — only the call from a real sandbox is left; the four read tools (NH-43) with 14 more tests and the three write tools (NH-44) with 11 more TypeScript tests and 47 SQL checks — for both, only a live smoke test is left; the chat channel — `assistant-send`, `assistant-outbox`, `assistant-deliver` (NH-51…53) — with 32 more tests and 32 SQL checks; the relay core (NH-54, `services/relay`) with 25 tests and a signing contract shared with the Edge Functions.
- 2026-09-28 … 30, local code, not deployed: M6 — fact extraction on Nemotron with per-operation validation and a Token Factory client (NH-61), the nightly memory job and its Supabase Cron schedule (NH-63), the daily check-in (NH-66), the memory evaluation's golden set and runner (NH-65) — what's left needs keys or a sandbox; M7's two screens — the coach assistant chat (NH-70) and "What the coach remembers" (NH-71) — behind the flags and in all 8 languages, checked by typecheck, 8 unit tests and a full Metro bundle. Test counts now: 177 Deno, 222 SQL checks on PGlite, 39 mobile, 25 relay.
- 2026-09-30, written, not yet run on a VPS: the cluster in [`deploy/`](../deploy/README.md) (NH-36) — bootstrap script, Argo CD app of apps, NetworkPolicies, secrets script, prod sync window — rendered offline with `kubectl kustomize`; the Images workflow (NH-37) that builds the relay image after green CI and commits its tag, with 6 tests for the tag bump. Pinned: k3s v1.36.4+k3s1, Argo CD v3.5.3, Agent Sandbox v1.0.4, OpenShell chart 0.1.2.
- 2026-09-30, written, not yet run in a sandbox: the Hermes coach profile (NH-40, NH-45) in [`deploy/images/hermes-sandbox`](../deploy/images/hermes-sandbox/README.md) — SOUL.md with the rules ported from today's coach, config.yaml with the D-29 allowlist — pinned by 9 tests; the relay now sends the coach's name, tone, accountability style and the user's style notes with every request, and turns cited links into sources the app can show.
- 2026-09-30, written, off until the spike proves it on the cluster: the sandbox manager (NH-55, NH-56) — per-user sandboxes created, started, stopped when idle and deleted with the account, at most 4 running in prod and 2 in dev with everyone else waiting in order — driving the `openshell` CLI; the queue's deferral and the sandbox mapping in SQL (25 SQL checks, 5 Deno tests); 27 relay tests; the OpenShell provider profiles for `notch-tools`, Token Factory and Tavily.
- 2026-09-30: the English README (NH-90) — what the assistant does, how Nemotron and Token Factory are used, architecture, ours versus upstream with licenses, setup with every variable, the submission-period changes. Writing it caught the Hermes profile contradicting D-03 and D-04: Tavily is now search only and thinking is off on assistant turns.
- 2026-09-30, written, not yet run on a VPS: backups, restore and monitoring (NH-34, NH-35) in [`deploy/ops`](../deploy/README.md#backups-and-restore-nh-34) — nightly encrypted backups of every gateway and sandbox volume with SQLite copied consistently, the restore that is also the move to member B's credits (NH-96), and a health check every 5 minutes reporting to a dead man's switch; billing alerts in the budget runbook. A test runs all three scripts on real files against a fake kubectl in a separate "Ops scripts" workflow, so it can't hold up a deploy; it first runs on the next push.
- 2026-09-30, ready to run on the VPS's first day: NH-28's Token Factory smoke test, [`scripts/token-factory-smoke.mjs`](../scripts/token-factory-smoke.mjs) — the tool round trip, `tool_choice: "required"` and JSON schema output with thinking off, per Nemotron model, as a table to paste into NH-28; 8 tests against a fake Token Factory. And NH-25's measurements, [`services/relay/src/bench.ts`](../services/relay/src/bench.ts): a scripted conversation, cold starts and a soak, run in the relay's pod with the relay's own prompt; 9 tests. And NH-26's probes: [`deploy/spike/sandbox-probe.sh`](../deploy/spike/sandbox-probe.sh) from inside a sandbox, [`services/relay/src/agent-probe.ts`](../services/relay/src/agent-probe.ts) against the agent. And NH-29's open question answered from OpenShell's docs and chart: the relay reaches its gateway with the chart's client certificate and no token (`allowUnauthenticatedUsers`, since there's no identity provider), and reaches a sandbox's Hermes port through the gateway by service hostname (`services/relay/src/gateway.ts`, with a real TLS test). NH-21 is prepared from NemoClaw's own image, and the relay now starts Hermes with `hermes gateway run`.
- 2026-09-30, drafts: the Devpost submission, the judges' testing instructions, the feedback, the video script and the judging-period checklist in [`submission.md`](./submission.md) (NH-91, NH-93, NH-95), with placeholders for links and live numbers.
- 2026-09-30 … 10-01, on GitHub: the Images workflow's first runs (NH-37, done) — the relay image built for `a06692a` and `4887498`, pushed to GHCR, its package public (pulled without credentials on 10-01), and both tag commits landed on `main`. The relay and the Hermes image now build in separate jobs and deploy separately, so a broken Hermes build can't hold back the relay.
- 2026-10-01, a full local run: typecheck, 84 relay, 39 agent, 39 mobile and 182 Deno tests, the locale and `deno check` checks, the script tests, a full Metro bundle, the kustomize renders and the backup, restore and health check tests all pass; the sandbox probe's test passes except its check that system directories aren't writable, which a root shell can't pass. The PGlite SQL checks counted above aren't in the repository, so neither CI nor anyone else can re-run them yet (rewritten on 10-03, below).
- 2026-10-03, in CI: SQL checks on a real Postgres 17 (PGlite 0.4.6) in [`supabase/db-tests`](../supabase/db-tests) — all 40 migrations applied on Supabase stand-ins, then 37 checks: RLS on every table and exactly which tables and security definer functions `anon` and `authenticated` can reach, the channel (send, caps, claim order, leases, retries, defer, delivery, context, check-ins, open jobs, sandbox records), the write tools and undo (D-22's scope), facts caps, deletion and memory apply, flags and the kill switch, spend, the demo seed (8 workouts, 128 sets) and its re-seed, the QA reset, and account deletion leaving no row behind. Each of five deliberate breakages (RLS off, the caps trigger dropped, a cascade dropped, a service-only function or a table opened to clients) fails its check.
- 2026-10-04, a review of the relay and the channel before the spike, three fixes: a turn's history now has the coach's own reply when the user sent a second message before the first was answered — the second turn didn't see the first answer and could repeat it (migration `20261004120000_assistant_context_replies.sql`, reproduced in a SQL check first); right after the relay creates or starts a sandbox Hermes is still booting, and a turn that finds nothing listening (a refused connection, or the gateway's 502/503) within two minutes of the start now waits in the queue unspent — before, its five attempts could burn in seconds, and a 502 was charged as spend; a check-in's SKIP counts with the punctuation or quotes a model adds. To check in the spike: whether `sandbox create --detach` returns before the sandbox is ready; whether the first create, which pulls the Hermes image, fits in the relay's liveness window (a heartbeat older than 5 minutes restarts it); and, in NH-25, whether two turns at a time are enough — the relay claims its next batch only when the slowest turn of the last one is done. If they aren't, claiming into free slots as turns end needs lease renewal first: today a turn that outlives its 180-second lease is harmless only because the relay claims nothing while a batch runs; a relay that keeps claiming would take that job again and run it twice. A first create that outlasts the 5-minute liveness window costs one relay restart, after which the sandbox finishes provisioning and the job, deferred meanwhile, runs; only the first pull is large, since the base layers are pinned by digest.
- 2026-10-04 … 05, a second review pass over the channel, the relay and the chat screen (13 commits, each reproduced first; relay 106, Deno 189 and SQL 45 checks pass): every turn whose reply can't be stored is now charged — after failed deliveries, a 404 or 409 from `assistant-deliver`, a reply with a NUL or an unpaired surrogate, or a source without a host; Hermes' own failure notices (Token Factory down or refusing, the repetition-loop abort, "no visible answer"), which it sends as a 200 reply, now fail the attempt instead of reaching the user as the coach's words; a check-in from an earlier UTC day is failed at claim, never sent late, and no longer answers a message the user sent while it waited; a job deferred for 30 minutes fails instead of holding the user's later messages for ever; work already queued is dropped when the kill switch, the user's flag or the paywall rules it out (check-ins now need a subscription, as `assistant-send` does), and a failed read retries instead of dropping; the chat shows a slow reply as slow, and "send again" links the new copy to the original by client id; `access.test.ts` pins every select policy `authenticated` reads through. D-17: `subscriptionAccess` in `_shared/mod.ts` gained an optional `throwOnError`, off by default, so the live coaching functions behave as before; `assistant-outbox` turns it on.
- 2026-10-04, the review's second half: a reply over the 8,000 characters `assistant-deliver` and `assistant_messages` accept — reachable when a user asks for a detailed program, since nothing caps Hermes' output — was refused, the relay let its lease run out, and each of the five attempts ran a paid turn that was never recorded against D-34. The relay now cuts a reply to fit (never mid-emoji: Postgres refuses a lone surrogate), and a delivery refused as invalid is reported at once as a failed attempt with its spend. The gateway route, `assistant-send`, `assistant-outbox`, `assistant-deliver` and `notch-tools` read clean otherwise.
- 2026-10-04, NH-21 without the VPS: NemoClaw publishes its built Hermes sandbox image (`ghcr.io/nvidia/nemoclaw/hermes-sandbox`, v0.0.130, 590 MiB compressed), so option 1 needs nothing of theirs built. Reading their wrapper showed our sandboxes would never have started: it refuses `hermes gateway` when the environment holds a raw secret-shaped value, and ours had two. The model id now reaches the sandbox as `NOTCH_MODEL`, and the API key — now 64 hex characters — goes into `$HERMES_HOME/.env` (mode 0640) before Hermes starts, the one place their boundary accepts it; their `validate-env-secret-boundary.py` refused the old environment and accepts the new one, in its strict installed mode too. Our Dockerfile adds the profile to their image, and both gateways default to it.

**Blocked, waiting on us:** everything in the first-run checklist below. NH-06 is urgent: the repository stays public (O-07), and the old instant-sign-in addresses in its history keep working in production until NH-06 is rolled out.

**Critical path:** NH-01 → NH-30 / NH-31 (VPS) → NH-28 (raw Token Factory tool-calling test) → NH-21 (OpenShell on k3s + Hermes image) → NH-22 / NH-29 → NH-25 / NH-26 → NH-27 go/no-go on **2026-10-04**. That date is tight: it holds only if credits and keys arrive by 2026-09-29.

### First-run checklist

Everything here is quick; it unblocks the whole critical path. Commands are bash.

**Both members**
- [ ] Redeem the event credits ($100 Token Factory + $100 AI Cloud), the hackathon promo form (`NEBIUS-DEVPOST-GLOBAL26`, +$25 Token Factory) and the Builders Program (+$25 Token Factory, Tavily credits): see [resources](https://nebiusglobalaihackathon.devpost.com/resources).
- [ ] Create a Token Factory API key. @Maximal1337 creates two (agent `dev`, agent `prod`); @dorhaimbob-web creates one (nightly memory job).
- [ ] Write down each account's credit issue and expiry dates. Credits expire 90 days after issuance; @dorhaimbob-web's AI Cloud credits must last to 2026-12-15.
- [ ] Register the team on Devpost (NH-02).

**@Maximal1337**
- [ ] Claim the Tavily key (NH-03).
- [ ] Look up the Supabase project's region in the dashboard (the privacy page says Asia-Pacific) and pick the Nebius region (O-02).
- [ ] Create the VPS (NH-30): Ubuntu 24.04 LTS, non-GPU preset 2 vCPU / 8 GiB, 60 GiB network SSD boot disk, a public IPv4, your own SSH key; security group inbound TCP 22 from your IP only. Note the public IP price — it isn't on the pricing page.
- [ ] Give Claude its own login (Claude generates the key pair on the laptop and hands over the public key):

  ```bash
  sudo adduser --disabled-password --gecos "" claude
  sudo usermod -aG sudo claude
  echo 'claude ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/claude
  sudo install -d -m 700 -o claude -g claude /home/claude/.ssh
  echo '<public key from Claude>' | sudo tee /home/claude/.ssh/authorized_keys
  sudo chown claude:claude /home/claude/.ssh/authorized_keys
  sudo chmod 600 /home/claude/.ssh/authorized_keys
  ```

  Revoke at any time with `sudo deluser --remove-home claude`.
- [ ] Put the agent `dev` Token Factory key on the VPS for NH-28 — never on the laptop or in the repo:

  ```bash
  sudo install -d -m 700 -o claude -g claude /home/claude/.config/notch
  sudo -u claude install -m 600 /dev/null /home/claude/.config/notch/tokenfactory.env
  sudo -u claude nano /home/claude/.config/notch/tokenfactory.env   # TOKEN_FACTORY_API_KEY=...
  ```
- [ ] Ask for extra AI Cloud credits in the [Nebius Discord](https://discord.gg/eXYTGhgnhK) (O-10). Draft:

  > Hi! We're building Notch for the Personal AI track: a fitness coach where every user gets their own Hermes agent in an OpenShell sandbox, running Nemotron on Token Factory. Keeping the demo up through the end of judging (Dec 15) needs a CPU VM for about 11 weeks, and our AI Cloud credits cover it only at the smallest size. Is there a way for hackathon teams to get additional AI Cloud credits? Happy to share details. Thanks!

**@dorhaimbob-web — NH-06 rollout** (full runbook: `.agents/skills/dev-test-scenario-accounts/SKILL.md`)
- [ ] Create the new test, review and demo/judge addresses (random, non-guessable), then:

  ```bash
  supabase secrets set DEV_TEST_LOGIN_EMAILS="<new addresses, comma-separated>"
  supabase db push
  supabase functions deploy dev-test-login --use-api
  # An old address must now be rejected with 403 {"error":"not_allowed"}:
  curl -s -w '\n%{http_code}\n' -X POST "https://<project-ref>.supabase.co/functions/v1/dev-test-login" \
    -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
    -d '{"email":"<an old address>"}'
  supabase functions delete coach-note
  ```
- [ ] Register and seed the demo and judge accounts (`private.demo_accounts`, `private.seed_demo_account(email)`), per the skill.
- [ ] Update the App Review account in App Store Connect to the new review address.

---

## Contents

0. [Status](#0-status--2026-09-27)
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
- **Runtime:** a Hermes agent per user, each in its own NVIDIA OpenShell sandbox, on a single-node k3s cluster on a Nebius VPS.
- **Model:** NVIDIA Nemotron via Nebius Token Factory.
- **Web search:** Tavily, as Hermes' web search backend.
- **Memory:** the coach remembers facts about the user; a nightly job keeps the list scored and up to date, and Hermes keeps its own per-user memory and skills inside the user's sandbox.
- **Delivery:** GitOps — CI builds images after green tests, Argo CD on the VPS pulls them.

The existing stack stays in place during the hackathon: Supabase, the Fly.io agent service and the Vercel landing page. New features are enabled only for team, demo and judge accounts via server-side feature flags. All real users keep the current experience until a post-hackathon rollout.

What we submit:
- **Stage A (required):** a "Coach chat" outside workouts, with Tavily search, personalization memory, write tools so the assistant acts on the user's behalf, and a proactive daily check-in.
- **Stage B:** cancelled for the hackathon; in-workout coaching on the new runtime moves to the post-hackathon backlog (PH-12 … PH-14).
- **Submission package:** public repo with an OSS license, English README, demo video under 3 minutes, TestFlight link with demo accounts.

**Glossary** — the names are easy to mix up:
- **NVIDIA OpenShell** — a Linux sandbox runtime for AI agents. It isolates each agent with Linux kernel features (Landlock, seccomp, network namespaces), holds credentials outside the agent, and enforces network policy. It has nothing to do with Microsoft PowerShell; only the name is similar.
- **NVIDIA NemoClaw** — NVIDIA's reference stack for running agents in OpenShell. We build on its published Hermes sandbox image (Hermes patched to run inside OpenShell); not its host installer, start script or policies (since 2026-10-04, NH-21).
- **Hermes Agent** — the open-source agent by Nous Research that runs inside each sandbox.

---

## 2. Hackathon constraints

Source: [Nebius x NVIDIA Global AI Hackathon rules](https://nebiusglobalaihackathon.devpost.com/rules)

- The project makes runtime calls to **Nebius Token Factory**, or runs on Nebius AI Cloud. The rules define AI Cloud use as Serverless Jobs, Serverless Endpoints or DevPods; a plain VM isn't in that list, so our eligibility rests on the Token Factory runtime call.
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
- The Personal AI track asks for an always-on, private assistant with persistent memory, reusable skills, access to the tools the user chooses, and the ability to carry out tasks. It names **NVIDIA NemoClaw, OpenShell, Hermes Agent and Nebius Serverless** as suggested tools. The judging hint: not a chatbot with a system prompt, but an assistant that **remembers across sessions and acts on the user's behalf**.
- The suggested tools and Tavily are **optional**; only the Nebius runtime call and the NVIDIA open model are mandatory.

---

## 3. Current architecture

As of 2026-09-27:

| Component | Runs on | Notes |
|---|---|---|
| Database | Supabase Postgres | 29 migrations, RLS on every table |
| Auth | Supabase Auth | Email OTP, Sign in with Apple |
| API layer | Supabase Edge Functions (Deno) | 11 functions + `_shared/mod.ts` (workout orchestration, rate limits, entitlement, usage accounting) and `_shared/assistant.ts` (flags, caps, CORS for the new endpoints) |
| LLM agent service | Fly.io app `gymcoach-agent` (fra) | `services/agent`; OpenRouter → Gemini 3.1 Flash-Lite; called only by Edge Functions with a shared secret |
| Landing & legal pages | Vercel | `apps/web` (Next.js) |
| iOS app | App Store (EAS builds) | Reads its own rows directly via RLS; mutations go through Edge Functions |
| Third-party services | RevenueCat, Expo Push, Sentry, PostHog, Apple | RevenueCat webhook → Supabase Edge Function |

---

## 4. Decisions

| ID | Decision | Status | Date | Rationale |
|---|---|---|---|---|
| D-01 | Compete in the **Personal AI** track | Confirmed | 2026-09-17 | A private assistant with persistent memory matches the track |
| D-02 | Agent runtime: NanoClaw | **Superseded by D-25** | 2026-09-27 | NanoClaw isn't in the hackathon's materials; the track names OpenShell, Hermes Agent and NemoClaw |
| D-03 | Model: **NVIDIA Nemotron via Nebius Token Factory**, routed per purpose — Super for interactive turns with `reasoning_effort: "none"`, Ultra with thinking on for the nightly memory job, Nano/Lightning for cheap classification. Inference goes through OpenShell's provider (D-28) | Confirmed; routing proposed | 2026-09-23 | Hackathon requirement. Thinking must be off on tool-calling turns: a reasoning model can spend `max_tokens` on thinking and return empty `content` |
| D-04 | Web search: **Tavily**, search only | Confirmed | 2026-09-17 | Bonus prize; extract is an exfiltration risk, so `web_extract` is disabled or blocked by egress policy (NH-23) |
| D-05 | **Keep Supabase** (Postgres, Auth, Edge Functions), the Fly.io agent service and Vercel; full infra migration deferred | Confirmed | 2026-09-17 | Migration cost doesn't fit the hackathon timeline |
| D-06 | Auth stays on **Supabase Auth**; no custom auth service | Confirmed | 2026-09-17 | Ready-made and already in production |
| D-07 | New features only for **team/demo/judge accounts** via server-side flags; all real users keep the current coach until after the hackathon | Confirmed | 2026-09-17 | No risk to real users during development |
| D-08 | Staged delivery: **Stage A required**; Stage B cancelled for the hackathon (PH-12 … PH-14) | Confirmed | 2026-09-27 | Keeps the in-workout path stable; capacity goes to Stage A |
| D-09 | Plan parsing and plan generation stay on **Gemini (OpenRouter)** | Confirmed | 2026-09-17 | Gemini reads PDFs and photos natively; Nemotron is text-only |
| D-10 | The repository is **public** with an OSS license | Confirmed | 2026-09-17 | Hackathon requirement; public since 2026-09-16 (O-07) |
| D-11 | Personalization: **typed facts, score computed in code**, max 15 facts per user | Confirmed | 2026-09-17 | LLM-assigned numeric scores drift between runs |
| D-12 | Document storage: **JSONB tables in Supabase**; no MongoDB | Confirmed | 2026-09-27 | Supabase has no separate NoSQL store; JSONB gives document flexibility without new infrastructure |
| D-13 | One NanoClaw agent group per user | **Superseded by D-26** | 2026-09-27 | Runtime changed |
| D-14 | The NanoClaw host pulls work from Supabase; no inbound traffic | **Superseded by D-27** | 2026-09-27 | Same principle, new runtime |
| D-15 | Nebius VM 2 vCPU / 8 GiB, Oct 1 → Dec 15 | **Superseded by D-31** | 2026-09-27 | Sizing, dates and accounts changed |
| D-16 | Judges test via a **public TestFlight link + seeded demo accounts** (one per judge) | Confirmed | 2026-09-27 | The App Store version for real users stays unchanged |
| D-17 | During the hackathon, existing coaching functions and the behavior of `_shared/mod.ts` do not change (NH-14 excepted). New code lives in new functions and `_shared/assistant.ts`; `mod.ts` may only gain new exports. Migrations are additive only | Confirmed | 2026-09-27 | Protects real users |
| D-18 | Work is tracked in **Linear** (§8) | Confirmed | 2026-09-17 | Team workflow |
| D-19 | OpenShell, Hermes and NemoClaw's Hermes blueprint are the **runtime, not the product**. The deliverable is our own software on top: the MCP tool server over real training data, the memory pipeline, per-user sandbox provisioning and the relay, the GitOps deployment, and the deterministic progression the agent must obey. README and video lead with those | Confirmed | 2026-09-27 | Stage 1 rejects a superficial rebrand of an open-source base; "deploy Hermes + Nemotron + Tavily" is configuration, not a project |
| D-20 | NanoClaw → Token Factory via a LiteLLM proxy or a patched provider | **Superseded by D-28** | 2026-09-27 | OpenShell supports OpenAI-compatible providers directly; NanoClaw issue #1984 no longer applies |
| D-21 | The assistant must **act**, not just answer: Stage A ships write tools (save a note, adjust an exercise in the plan) and the proactive daily check-in is required, not a stretch | Confirmed | 2026-09-23 | The Personal AI judging hint is explicitly about memory across sessions plus acting on the user's behalf |
| D-22 | Stage A write scope: without a confirmation step the assistant may save a note and change the **parameters of one exercise in one active plan** — sets, rep range, rest, intensity, warm-up — but never swap the movement itself, and not while that workout is being trained. Everything else — creating or archiving plans, bulk edits, touching history, account or subscription settings — stays out of Stage A. Every write is recorded in `assistant_actions` and reversible with an `undo_last_change` tool for 24 hours, and the reply states exactly what changed | Confirmed; narrowed 2026-09-28 | 2026-09-23 | A "are you sure?" round trip defeats the point of an assistant that acts; an audit trail plus undo gives the same safety without it, and doubles as the trust story in the demo. No movement swaps: there was no plan-editing write path to reuse, and `set_logs` and progression key on `exercise_id` — renaming barbell bench to dumbbell press would turn one history into the other and make progression suggest the wrong weights, while deleting the row would cascade the history away |
| D-23 | The nightly memory job stays on **Supabase Cron + an Edge Function**. A Nebius Serverless Job only if the job outgrows Edge Function time limits | Confirmed | 2026-09-23 | Nebius Serverless is on the track's suggested list, but Nebius is already used honestly twice — Token Factory for inference, a VPS for the agent runtime. A Serverless Job purely to name a third service is box-ticking and adds an image build, secrets and scheduling for no product gain |
| D-24 | Credits are split by component. **Member A = @Maximal1337:** the VPS until 2026-11-14 and the agent's Token Factory keys (dev and prod). **Member B = @dorhaimbob-web:** the VPS from 2026-11-15 and the nightly memory job's key | Confirmed | 2026-09-27 | Credits are non-transferable; separate keys double the usable Token Factory budget and make spend per component visible |
| D-25 | Agent runtime: **NVIDIA OpenShell on Kubernetes** (the official Helm chart plus the Agent Sandbox controller) running **Hermes Agent**. The sandbox image and policy presets are built from NemoClaw's Hermes blueprint; NemoClaw's host installer is not used | Confirmed | 2026-09-27 | The track names OpenShell and Hermes; OpenShell's Kubernetes mode fits the GitOps setup (D-32) and makes sandboxes ordinary pods |
| D-26 | **One OpenShell sandbox with its own Hermes per user.** No shared spaces, ever: memory, skills, sessions and files are per user. When capacity runs out, requests wait in a queue; they are never merged into a shared space. Idle sandboxes are stopped and keep their state on their own volume | Confirmed | 2026-09-27 | Only a per-sandbox boundary is enforced by the kernel rather than by our code; Hermes keeps memory, skills and session search per instance, so a shared instance would mix users |
| D-27 | The VPS accepts **no inbound traffic except SSH**. Argo CD pulls from GitHub; the relay pulls work from Supabase and calls the user's sandbox Hermes API with that sandbox's own key; the Argo CD CLI is used over SSH | Confirmed | 2026-09-27 | Nothing to authenticate on the way in, nothing exposed; migration (D-31) needs no IP or DNS change |
| D-28 | Inference goes through **OpenShell's OpenAI-compatible provider to Token Factory**. The gateway injects the Token Factory and Tavily keys and the user's tool token; the agent never sees them | Confirmed | 2026-09-27 | Documented path, no proxy or patched provider; keys stay out of the agent's reach |
| D-29 | **Least privilege** in every sandbox: terminal, file tools, code execution and browser disabled; enabled only `notch-tools` (MCP), web search (Tavily backend), Hermes memory and skills. `max_concurrent_runs: 1` per sandbox | Confirmed | 2026-09-27 | The coach reads and writes training data only through our validated tools; nothing else is needed |
| D-30 | Two memory layers. Hermes' own memory and skills are on — they are isolated in the user's sandbox. The **canonical, user-visible layer is D-11's facts**, which the relay passes with every request as data, never as instructions. Hermes' own user profile (USER.md) stays off and its memory keeps coaching know-how only, so a fact the user deletes can't live on inside Hermes (NH-45) | Confirmed | 2026-09-27 | Hermes' memory and skills are what the track asks for; our scored facts are what the user can see, delete and trust |
| D-31 | **One Nebius VPS at a time, strictly inside the credits.** Ubuntu 24.04, 60 GiB disk. 2026-09-29 → 2026-11-14 on @Maximal1337's credits at 2 vCPU / 8 GiB, temporarily 4 vCPU / 16 GiB between 10-12 and 10-29 only if NH-25 shows the need and the spend forecast stays ≤ 90% of credits. 2026-11-15 → 2026-12-15 on @dorhaimbob-web's credits: 2 vCPU / 8 GiB, 4 vCPU / 16 GiB for judging from 12-01. One k3s with `notch-dev` and `notch-prod` namespaces and NetworkPolicy between them; `notch-dev` exists only until 11-14 and serves team accounts only. RAM savings: k3s without traefik, servicelb and metrics-server; Argo CD core (no UI or API server); at most 4 running prod sandboxes and 2 dev, idle ones stopped after 10 minutes | Confirmed | 2026-09-27 | Keeps the whole run under $200 of AI Cloud credits with no out-of-pocket spend (§7). The move on 11-15 is a GitOps re-bootstrap plus a volume restore (NH-96) |
| D-32 | **GitOps.** After green tests, CI builds the images (relay, Hermes sandbox) for `linux/amd64`, pushes them to GHCR and commits the new tags to the manifests. Argo CD auto-syncs both namespaces from `main`. A sync window blocks `notch-prod` syncs from 2026-12-01 to 2026-12-15. No secrets in Git (Sealed Secrets, or `kubectl create secret` by hand). No self-hosted GitHub runner on the VPS | Confirmed | 2026-09-27 | Only CI changes an image tag, so untested code never reaches the cluster. Both namespaces track `main`, so dev doesn't catch a break before prod — CI and tests are the gate. Self-hosted runners are unsafe on public repositories |
| D-33 | **Linux only.** The VPS runs Ubuntu 24.04, CI runs on `ubuntu-latest`, images are `linux/amd64`. Scripts are bash/POSIX or Node; no `.ps1` files or Windows-specific tooling. The laptop is an editor, a git client and an SSH client | Confirmed | 2026-09-27 | One target platform; nothing depends on the developer's OS |
| D-34 | **Hard Token Factory ceilings.** Agent keys (dev and prod, @Maximal1337): $1.5 a day in total — prod $1, dev $0.5 — at most ≈ $117 of $150. Nightly memory (@dorhaimbob-web): $0.5 a run, at most ≈ $39 of $150. `_shared/assistant.ts` counts actual token spend; at the ceiling the assistant says the daily limit is reached. Spend is checked every Monday; if the forecast exceeds 90% of credits, dev goes off first, then the ceilings come down | Confirmed | 2026-09-27 | No out-of-pocket spend; a worst case is bounded by construction, not by hope |

---

## 5. Open decisions

**Still open:**

| ID | Question | Owner | Due | Default if not decided |
|---|---|---|---|---|
| O-02 | Supabase project region → Nebius region | @Maximal1337 | 2026-09-29 | The privacy page says Asia-Pacific; pick the Nebius region with the lowest measured latency to the Supabase project |
| O-10 | Extra AI Cloud credits from the organizers | @Maximal1337 | 2026-10-01 | Ask in the Nebius Discord (draft in §0). The plan doesn't count on it; if granted, keep 4 vCPU / 16 GiB for the whole run |
| O-11 | Can two OpenShell gateways (dev and prod) share one cluster, given the Agent Sandbox controller is cluster-wide? As objects, yes: the chart's cluster-scoped names carry the release namespace (checked in chart 0.1.2); `deploy/` is laid out that way. What's left is runtime behaviour | @Maximal1337 | 2026-10-04 (NH-21) | One gateway with separate sandbox namespaces, providers and policies per environment |
| O-12 | Does 2 vCPU / 8 GiB hold 4 running prod sandboxes plus 2 dev? | @Maximal1337 | 2026-10-04 (NH-25) | Shorter idle timeout first, then 4 vCPU / 16 GiB within the credits (D-31) |

**Resolved on 2026-09-27:**

| ID | Question | Answer |
|---|---|---|
| O-01 | Which member is "A"? | @Maximal1337 (D-24) |
| O-03 | License and copyright holder | MIT, "The Notch authors" — `LICENSE` stays as is |
| O-04 | Spike go/no-go thresholds | p95 reply ≤ 15 s; sandbox cold start ≤ 60 s; ≤ $0.05 per 10-turn conversation; Nemotron calls tools reliably through Hermes; everything fits in 8 GiB with 4 running prod sandboxes and 2 dev |
| O-05 | How the runtime reaches Token Factory | Obsolete: OpenShell's OpenAI-compatible provider (D-28) |
| O-06 | Owner per milestone | See §9 |
| O-07 | The repository has been public since 2026-09-16 with personal data in its history | It stays public; the exposure is accepted. `app-store-connect-form.md` stays where it is — the creator's call. NH-06 rollout is urgent so the old instant-sign-in addresses stop working |
| O-09 | Capacity and scope | 20–30 hours a week each. The team commits to the full plan without cuts and accepts the risk of not finishing everything (§9) |

---

## 6. Target architecture

```
iOS app (TestFlight build) ──JWT──► Supabase Edge Functions ──► Supabase Postgres (+ Queues, Cron)
                                      ├─ assistant-send    (auth, flag, rate limit, D-34 ceilings)
                                      ├─ assistant-outbox  (relay pulls work; per-env secret)      ◄──┐
                                      ├─ assistant-deliver (HMAC, store reply, push)               ◄──┤ outbound
                                      ├─ notch-tools MCP   (per-user token)                        ◄──┤ HTTPS only
                                      └─ memory-nightly    (Cron 00:00 UTC → Token Factory, key B)    │
                                                                                                      │
GitHub main ──(Argo CD pulls manifests)──┐   GHCR ──(images pulled)──┐                               │
                                         ▼                           ▼                               │
Nebius VPS · Ubuntu 24.04 · single-node k3s · no inbound except SSH                                  │
 ├─ argocd (core)                     ├─ agent-sandbox controller (cluster-wide)                      │
 ├─ notch-prod: OpenShell gateway · relay ────────────────────────────────────────────────────────────┤
 │    └─ one sandbox pod per user: Hermes with its own memory, skills, sessions and volume            │
 │         egress only through gateway policy: Token Factory (key A, injected), Tavily, notch-tools   │
 └─ notch-dev (until 2026-11-14): same layout, team accounts only ────────────────────────────────────┘

Unchanged for real users: services/agent on Fly.io (Gemini) — current workout coach,
plan parsing and generation
```

Invariants:
- Supabase is the source of truth. Neither the agent nor the VPS holds database credentials.
- Every write goes through `notch-tools`, which validates it against the database (same rule as today's coach).
- Numbers shown in the UI (targets, progress) come from server-side tool results, never from agent prose.
- One sandbox per user; no shared spaces; capacity limits queue requests, never merge them (D-26).
- The agent never sees an API key or a tool token; the OpenShell gateway injects them (D-28).
- The VPS accepts no inbound traffic except SSH (D-27).
- Every cluster change goes through Git, except secrets (D-32).
- D-17 applies to all changes in `supabase/`.

---

## 7. Budget

**Rule: no out-of-pocket spend.** Everything fits inside the credits.

**Available credits (per member, non-transferable):**
- Builders & Brews Tel Aviv event: **$100 Token Factory + $100 AI Cloud**, plus Tavily credits.
- Hackathon promo code `NEBIUS-DEVPOST-GLOBAL26`: **+$25 Token Factory**.
- Nebius Builders Program (dev.nebius.com/builders): **+$25 Token Factory**, plus Tavily credits and Academy access.
- Roughly **$150 Token Factory + $100 AI Cloud** per member, **$300 + $200** for the team. Credits expire 90 days after issuance.
- There is no official way to get more. Asking the organizers is O-10; the plan doesn't count on it.

**VPS** at Nebius list prices ($0.012 per vCPU-hour + $0.0032 per GiB-hour; network SSD $0.071 per GiB-month): 2 vCPU / 8 GiB is $0.0496/h, 4 vCPU / 16 GiB is $0.0992/h. Stopped VMs aren't billed for compute; disks are.

| AI Cloud account | Period | Base plan | With the optional upsize | If Nebius raises prices (+25% CPU / +41% RAM) |
|---|---|---|---|---|
| @Maximal1337 ($100) | 09-29 → 11-14, 47 days | 2/8 + disk ≈ **$63** | + 4/16 on 10-12 → 10-29 ≈ **$84** | ≈ $81, no upsize |
| @dorhaimbob-web ($100) | 11-15 → 12-15, 31 days | 2/8, then 4/16 from 12-01, + disk ≈ **$59** | — | ≈ $77 |
| **Total of $200** | | **≈ $122** | ≈ $143 | ≈ $158 |

- The base plan leaves at least $16 on each account. The public IP price isn't on the pricing page; that headroom covers it. Check it on day one.
- Media reports mention CPU and memory price increases; the official pricing page doesn't show them yet. The worst-case column assumes them.
- Backups (NH-34) in Object Storage: $0.0147 per GiB-month, 14 days of nightly archives of a few hundred MB — cents, inside the headroom.

**RAM on 2 vCPU / 8 GiB** (to be measured in NH-25):
- Base: OS ≈ 0.5 GiB, k3s without extra components ≈ 0.5, Argo CD core ≈ 0.4, the sandbox controller, two OpenShell gateways and two relays ≈ 0.8. About 2.2 GiB in total, leaving ≈ 5.5 GiB for sandboxes.
- Hermes, per third-party reports: ≈ 280 MB median at idle, ≈ 1.1 GB peak during a heavy turn. The 4 prod + 2 dev ceiling should fit; NH-25 confirms it first.
- If it doesn't fit: a shorter idle timeout first, then a temporary 4/16 within the credits. Shared spaces are never the answer (D-26).

**Token Factory:**

| Item | Sizing | Estimate |
|---|---|---|
| Agent turns (dev, demo, judging) | Nemotron 3 Super ($0.30 in / $0.90 out per 1M) | ≈ $30–60 |
| Proactive daily check-in | One short turn per flagged user per day | ≈ $5–10 |
| Nightly memory job | Nemotron 3 Ultra ($1 / $3 per 1M), thinking on | ≈ $15–25 |
| **Expected total** | | **≈ $50–90 of $300** |
| **Hard ceiling (D-34)** | $1.5/day on member A's keys, $0.5/run on member B's | ≤ ≈ $117 of $150 (A), ≤ ≈ $39 of $150 (B) |

- Tavily: Builders Program credits and free tier, ≈ $0.
- Gemini via OpenRouter: unchanged, current spend.
- If Token Factory credits run low: move extraction and simple turns to Nemotron 3.5 Lightning ($0.06 / $0.24 per 1M), after an eval.

**Guardrails:** billing alerts on both accounts (Billing → Budgets, set up per the [budget runbook](./budget-runbook.md)); the Monday spend check (NH-38); the D-34 ceilings; per-account message caps for demo and judge accounts; the kill-switch flag.

---

## 8. Linear setup

**Team:** the existing Notch team. Code comments already reference `GYM-` issue keys.

**Projects:**
- **Notch × Nebius Hackathon** — target date 2026-10-30; milestones M0–M10 (§9, M8 cancelled); issues NH-01 … NH-96 (§10).
- **Notch — Post-hackathon** — backlog PH-01 … PH-16 (§12).

**Label groups:**
- `Area`: Backend (Supabase), Agent (Hermes/OpenShell), Mobile, Infra (Nebius, k3s, Argo CD), Memory, Security, Docs, QA
- `Type`: Feature, Spike, Chore, Bug

**Priority:**
- Urgent: blocks other work or is deadline-critical
- High: required for submission
- Medium: should do
- Low: nice-to-have

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
- Cluster changes land through Git and Argo CD; nothing changed by hand except secrets.
- No secrets in code.
- §4 updated if a decision changed.

---

## 9. Milestones and timeline

| ID | Milestone | Target date | Owner | Issues | Points |
|---|---|---|---|---|---|
| M0 | Credits, compliance, safety net | 2026-10-01 | Both; Supabase rollouts @dorhaimbob-web | NH-01 … NH-08 | 14 |
| M1 | Foundations | ✅ 2026-09-18 | — | NH-10 … NH-15 | 14 |
| M2 | VPS and runtime spike, go/no-go | 2026-10-04 | @Maximal1337 | NH-20 … NH-31 | 31 |
| M3 | Platform: GitOps, gateways, budget controls | 2026-10-09 | @Maximal1337 | NH-32 … NH-38 | 21 |
| M4 | Coach profile and tools | 2026-10-12 | @dorhaimbob-web | NH-40 … NH-45 | 22 |
| M5 | Channel, relay and sandbox lifecycle | 2026-10-14 | @Maximal1337 | NH-50 … NH-57 | 30 |
| M6 | Personalization memory | 2026-10-18 | @Maximal1337 | NH-60 … NH-66 | 23 |
| M7 | TestFlight demo build | 2026-10-20 (build submitted to Beta App Review by 10-16) | @dorhaimbob-web | NH-70 … NH-73 | 12 |
| M8 | ~~Stretch: in-workout coaching~~ | Cancelled → PH-12 … PH-14 | — | — | — |
| M9 | Submission | 2026-10-26 (hard deadline 2026-10-30 10:00 PT) | @dorhaimbob-web; README together | NH-90 … NH-93 | 9 |
| M10 | Move and judging support | 2026-11-15 → 2026-12-15 | Both | NH-95, NH-96 | 3 |

**Scope:** **179 points** in total, 40 done (M1, NH-04, NH-05, NH-07, NH-08, NH-20, NH-37, NH-38, NH-41, NH-50, NH-57, NH-60, NH-62) — **139 remaining ≈ 49 person-days**; NH-42…NH-44 and NH-51…NH-53 are code-complete and wait only for a live smoke test after deploy on the §8 scale.

**Capacity versus scope — decided 2026-09-27.** 20–30 hours a week each over four weeks is about 20–30 person-days. The §8 scale assumes hand-written code; Claude writes most of the code, scripts and manifests and runs the VPS work over SSH, so the real constraint is the team's time for accounts, reviews, device testing, TestFlight and the video. **The team commits to the full plan without cuts and accepts the risk of not finishing everything.**

**Minimum viable submission** (reference only — what the submission can't do without): everything except NH-56, NH-57, NH-65 and NH-71, with NH-35 cut down to billing alerts, an uptime ping and the per-sandbox RSS watchdog. That's **167 points, 129 remaining.** It still satisfies every mandatory rule, the track's judging hint and the Tavily bonus; without NH-71, facts are listed and deleted from a section of the chat screen.

Never cut: NH-05, NH-06, NH-26, NH-31, NH-32, NH-38, NH-44, NH-66. Without NH-44 and NH-66 the submission is a chatbot, which the track's judging hint rules out (D-21); without NH-26 isolation is unverified; without NH-38 the budget isn't bounded.

| Week | Dates | Focus |
|---|---|---|
| 1 | Sep 17–23 | ✅ M1 and NH-13 done, M0 mostly done |
| 2 | Sep 24–Oct 4 | First-run checklist and NH-06 rollout (§0); VPS up (NH-30/31); NH-28 first; M2 spike; go/no-go **Oct 4** |
| 3 | Oct 5–11 | M3 (Argo CD, CI images, gateways, egress, budget controls); M4 and M5 start |
| 4 | Oct 12–18 | M4, M5, M6; Coach chat screen; TestFlight build submitted by **Oct 16** |
| 5 | Oct 19–25 | M7 end-to-end run; M9 README and video |
| 6 | Oct 26–30 | Submit on Oct 26 (hard deadline Oct 30, 10:00 PT) |
| — | Nov 1–14 | Quiet period: restore drill (NH-34), monitoring |
| — | Nov 15 | VPS moves to @dorhaimbob-web's credits (NH-96) |
| — | Dec 1–15 | Judging: prod upsized to 4/16, prod syncs frozen, spend watched |

---

## 10. Issues by milestone

### M0 — Credits, compliance, safety net · target 2026-10-01

#### NH-01 · Join Nebius Builder Program and redeem hackathon credits
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** —

Both members redeem the event credits, the promo form and the Builders Program (§0 checklist).

- [ ] AI Cloud and Token Factory credits are visible in both accounts
- [ ] Token Factory keys created: agent `dev` and agent `prod` on member A's account, nightly memory on member B's (D-24)
- [ ] Credit issue and expiry dates recorded; member B's AI Cloud credits last to 2026-12-15
- [ ] Billing alerts configured where Nebius supports them; the public IP price noted in §7

#### NH-02 · Register the team on Devpost and confirm eligibility
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** —

- [ ] Team registered; Personal AI track noted
- [ ] Every member confirmed eligible under the official rules
- [ ] Key dates added to the Linear project (submission 2026-10-30 10:00 PT; judging 2026-12-01 → 12-15)

#### NH-03 · Claim Tavily credits and create an API key
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Agent, Type/Chore · **Blocked by:** —

- [ ] API key created and stored in the team password manager, never in the repo
- [ ] Available credits and limits noted in §7

#### NH-04 · Choose and add a root LICENSE ✅
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** —

- [x] License agreed by both members (O-03: MIT, "The Notch authors")
- [x] `LICENSE` at the repo root
- [ ] `apps/mobile/LICENSE` (Expo template) reviewed: keep, replace or remove

#### NH-05 · Scan the full git history for secrets ✅
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Security, Type/Chore · **Blocked by:** —

- [x] Scan report attached to the issue
- [x] Every finding rotated or confirmed as non-secret
- [x] Scan added to the pre-submission check (NH-92)

**Findings (2026-09-18):** a local pattern scan of all refs found no API keys, tokens, JWTs or private keys, and no `.env` file was ever committed. The history does contain personal data — accepted under O-07. It also contains the old test and review sign-in addresses; those become harmless once NH-06 rotates them. `.github/workflows/secret-scan.yml` runs gitleaks over the full history.

#### NH-06 · Move test and review account allowlists out of code; rotate the review account
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Backend, Area/Security, Type/Chore · **Blocked by:** —

Code done on 2026-09-18; the rollout is in the §0 checklist. The repository is public, so until the rollout the old addresses are working instant-sign-in credentials.

- [x] Allowlist comes from Supabase secrets (function) and a table with no client access (SQL function), not from code
- [ ] New test and App Store review accounts created; the old addresses are rejected by `dev-test-login` (403)
- [ ] App Review information in App Store Connect updated with the new review account
- [ ] Additive migrations applied; verified with a live smoke test
- [x] No test or review address left in `sign-in.tsx` or `.agents/skills/*`. `app-store-connect-form.md` stays as is (O-07); the new review address is never written into it

#### NH-07 · CI: run unit tests ✅
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/QA, Type/Chore · **Blocked by:** —

- [x] CI runs the `services/agent` tests (`src/*.test.ts`) and the mobile tests (`src/lib/*.test.ts`)
- [x] A failing test fails the workflow

#### NH-08 · CI: `deno check` for Edge Functions and locale validation ✅
**Priority:** Medium · **Estimate:** 3 · **Labels:** Area/QA, Type/Chore · **Blocked by:** —

- [x] `deno check` runs for every function against a recorded baseline of known errors; new errors fail CI
- [x] All 8 locale JSON files validated

### M1 — Foundations · ✅ done 2026-09-18

#### NH-10 · Per-user feature flags ✅
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** —

- [x] Additive migration: `feature_flags(flag, enabled, …)` (one global switch per flag) and `user_flags(user_id, flag, enabled, updated_at)`; clients read their own effective flags via `my_feature_flags()` and never write
- [x] Helper `isFlagEnabled(db, userId, flag)` in `supabase/functions/_shared/assistant.ts`, failing closed
- [x] Flags defined: `assistant_chat`, `assistant_memory`, `assistant_workout`. A flag is on only when its global switch and the user's row are both on, so the global switch is the kill switch
- [x] Only team and demo accounts have flags enabled

#### NH-11 · Shared config for new Edge Functions ✅
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/Backend, Type/Chore · **Blocked by:** —

- [x] `_shared/assistant.ts` holds rate limits, per-account and global daily caps, supported languages and allowed CORS origins for the new functions
- [x] Existing `_shared/mod.ts` behavior unchanged (D-17)

#### NH-12 · Mobile: read flags and gate new screens ✅
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Mobile, Type/Feature · **Blocked by:** NH-10

- [x] Flags loaded after sign-in and cached for the session
- [x] New entry points hidden unless the corresponding flag is on
- [x] Full Metro bundle compiles (`verify` skill)

#### NH-13 · Seeded demo and judge accounts ✅
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Backend, Area/QA, Type/Feature · **Blocked by:** NH-06, NH-10

Memory only shows up with history, so demo accounts need realistic data. Follow the repo's `dev-test-scenario-accounts` skill.

- [x] One team demo account plus five judge accounts (one per judge), with instant login from the secret allowlist
- [x] Each account seeded with a coach profile, active plans, ~2 weeks of workouts and chat messages
- [ ] Facts come from the first nightly run over the seeded chat (NH-63), the same path real users take — no hand-written facts in the seed
- [x] Flags enabled only for these accounts; per-account daily caps apply

**Implementation (2026-09-18):** migration `20260918140000_demo_accounts.sql` adds `private.demo_accounts` (the registry) and `private.seed_demo_account(email)`. The `private` schema isn't exposed through the API, so the seed runs only from the SQL editor or `supabase db query`. It seeds an English persona: Upper/Lower plan, 8 workouts / 128 sets whose weights follow `progression.ts`, 32 workout-chat messages rich in personal context for the memory job, 2 saved notes and both assistant flags. It refuses unregistered and QA-scenario addresses because it wipes the account first. Re-run it right before judging. Runbook: `dev-test-scenario-accounts` skill, "Demo and judge accounts". Facts get added to the seed with NH-60.

#### NH-14 · Fix message-length drift in coach-turn ✅
**Priority:** Medium · **Estimate:** 1 · **Labels:** Area/Backend, Type/Bug · **Blocked by:** —

**Resolution (2026-09-18):** no user-facing drift. The app's composer already caps input at 200 characters (`maxLength` in `apps/mobile/app/(tabs)/train.tsx`), matching `coach-turn`; the agent's 2000 is only a looser outer bound. Closed as won't fix.

#### NH-15 · Remove dead code ✅
**Priority:** Low · **Estimate:** 1 · **Labels:** Area/Backend, Area/Agent, Type/Chore · **Blocked by:** —

- [x] `coach-note` Edge Function removed from the repo (undeploy is in the §0 checklist)
- [x] Unused `buildOrchestrationIntroPrompt` (`services/agent/src/prompt.ts`) and `services/agent/src/llm-smoke.ts` removed
- [x] Typecheck green

### M2 — VPS and runtime spike, go/no-go · target 2026-10-04

Everything runs on the VPS; nothing is installed on a laptop (D-33). Claude runs the commands over SSH with its own key (§0).

#### NH-30 · Provision the VPS
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-01

- [ ] Ubuntu 24.04 LTS, 2 vCPU / 8 GiB, 60 GiB network SSD, in the region from O-02, on member A's account
- [ ] `claude` user with its own SSH key and sudo (§0); the owner's own user separate
- [ ] Hourly cost checked against §7, public IP price recorded

#### NH-31 · Harden the VPS
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Infra, Area/Security, Type/Chore · **Blocked by:** NH-30

- [ ] SSH with keys only, source IPs restricted, password login and root login disabled
- [ ] No inbound ports other than SSH, in the security group and in the host firewall
- [ ] fail2ban and unattended security upgrades enabled

#### NH-28 · Raw Token Factory smoke test: Nemotron tool calling
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-01, NH-30

Runs **first**, on the VPS, before any runtime wiring, so a model problem can't be mistaken for a harness problem. Two known failure modes to rule out: a reasoning model spending `max_tokens` on thinking and returning empty `content`, and tool calls breaking on reasoning models.

Ready to run (written 2026-09-30, its logic tested against a fake Token Factory): [`scripts/token-factory-smoke.mjs`](../scripts/token-factory-smoke.mjs) lists the models, runs the checks below on every Nemotron chat model the key sees, and prints a Markdown table to paste here. It reads the key from the file in §0 and never prints it:

```bash
sudo apt-get install -y nodejs          # Node 18 from Ubuntu; nothing else
node scripts/token-factory-smoke.mjs    # or --model <id>, repeatable
```

- [ ] `GET /v1/models` lists the Nemotron IDs we plan to use (Super, Ultra, Nano/Lightning)
- [ ] A full two-step tool call (request → `tool_calls` → tool result → final answer) succeeds on the interactive model with `reasoning_effort: "none"`
- [ ] `tool_choice: "required"` and a `response_format: json_schema` call both succeed — the memory job depends on schema output
- [ ] Recorded per model: latency, tokens, and whether `reasoning_content` ever arrives instead of `content`
- [ ] If every Nemotron fails at tool calling: decide between a different Nemotron variant or keeping tool calling in our own loop, and ask in the Nebius Discord

#### NH-20 · Agree spike go/no-go thresholds ✅
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** —

- [x] O-04 resolved; thresholds recorded in §5

#### NH-21 · k3s, OpenShell through Helm, and the Hermes sandbox image
**Priority:** Urgent · **Estimate:** 5 · **Labels:** Area/Agent, Area/Infra, Type/Spike · **Blocked by:** NH-31

- [ ] k3s installed without traefik, servicelb and metrics-server; versions pinned
- [ ] Agent Sandbox controller and the OpenShell Helm chart installed per the OpenShell Kubernetes setup guide; versions pinned
- [ ] Hermes sandbox image built for `linux/amd64` from NemoClaw's Hermes blueprint plus our config; a test sandbox answers through the Hermes API — prepared 2026-09-30 from NemoClaw's own Dockerfile and start script ([the image README](../deploy/images/hermes-sandbox/README.md#for-the-dockerfile-nh-21)). Their start script refuses a config that doesn't match a hash pinned at build time, and it also runs a dashboard. So the first option is their image as the base with our own start command: install the profile, then `hermes gateway run` in the foreground. The relay's default command said `hermes gateway` and now says that. 2026-10-04: option 1 is in — `deploy/images/hermes-sandbox/Dockerfile` is NemoClaw's published `hermes-sandbox:v0.0.130`, pinned by digest, plus our profile, built by CI and set as both gateways' default sandbox image. Their `hermes` wrapper would have refused to start Hermes with our environment (a raw `API_SERVER_KEY`, and `TOKEN_FACTORY_MODEL` read as a secret); fixed and checked with their own guard script, details in the image README. Left: a test sandbox answering through the Hermes API on the cluster.
- [ ] O-11 answered: two gateways in one cluster, or one gateway with per-environment namespaces
- [x] After the first Images run that pushes it, the `notch-hermes-sandbox` package set to public in GHCR, or the cluster can't pull it (`deploy/README.md`, "Adding the Hermes sandbox image") — it came out public from its first build on 2026-10-04 (`sha-4655445706c5`, pulled without credentials), like the relay's
- [ ] Upstream licenses (OpenShell, NemoClaw, Hermes) recorded for the README

#### NH-22 · Connect Nemotron via Token Factory
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-21, NH-28

- [ ] OpenShell's OpenAI-compatible provider points at Token Factory; the key lives in the gateway, not in the sandbox (D-28)
- [ ] The agent answers with Nemotron and calls an MCP tool end to end (the tool's result is used in the reply)
- [ ] Interactive turns run with thinking off; confirmed that `reasoning_effort` survives the inference router, or the equivalent setting is found and written down
- [ ] Confirmed from Token Factory usage that the requests reach Token Factory and nothing falls back to another provider

#### NH-23 · Tavily as Hermes' web search backend
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-03, NH-21

- [ ] `web.backend: tavily` with the key injected by the gateway
- [ ] `web_extract` disabled; if Hermes can't disable it on its own, egress policy allows only Tavily's search endpoint — both are written: the Hermes config offers the `search` toolset (web_search alone) and disables `web`, and the `tavily` provider profile allows only `POST /search`; checked live in the spike
- [ ] A test question produces an answer that cites its sources

#### NH-24 · Prototype the relay
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-21

- [ ] A relay polls a mock outbox, calls a sandbox's Hermes API (`/v1/chat/completions`) with that sandbox's key, and posts the reply to a mock endpoint
- [ ] Full round trip works for one test user

#### NH-29 · Prototype per-user sandbox provisioning
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Agent, Area/Security, Type/Spike · **Blocked by:** NH-21

- [ ] A sandbox for a given user is created programmatically from the Hermes image with that user's config: persona, tool whitelist (D-29), `notch-tools` MCP with the user's token injected by the gateway
- [ ] Stop and start keep the user's memory and skills on the sandbox's own volume
- [ ] Destroy removes the sandbox, its volume and its credentials
- [ ] Idempotent: creating an existing user's sandbox twice changes nothing
- [ ] The relay reaches its gateway and the sandboxes' Hermes ports. Written 2026-09-30 from the OpenShell docs and chart (`services/relay/src/gateway.ts`, 4 tests including a real TLS exchange):
  - **No token.** On Kubernetes a user call to the gateway carries an OIDC token or none. We run no identity provider, so user calls come without one (`allowUnauthenticatedUsers`), but TLS still requires the chart's client certificate. The relay mounts it from `openshell-client-tls`; only its own namespace can reach the gateway.
  - **CLI registration.** At startup the relay registers its CLI with `openshell gateway add <endpoint> --local`.
  - **Service URLs.** A sandbox's service URL (`<sandbox>.openshell.localhost`, covered by the gateway certificate) goes to the gateway's address, with that hostname as SNI and Host.
  - **To confirm here:** the service URL's form, and that `gateway add --local` takes the mounted bundle.

#### NH-25 · Measure latency, tokens, RAM, cold start and the leak
**Priority:** Urgent · **Estimate:** 5 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-22, NH-24, NH-29

Tools ready (2026-09-30, 9 tests): [`services/relay/src/bench.ts`](../services/relay/src/bench.ts), run in the relay's pod against a team test account's sandbox. It sends the relay's own prompt, so the tokens are a real turn's, and prints tables with the O-04 thresholds checked:

```bash
R="kubectl -n notch-dev exec deploy/notch-relay -- node --import tsx src/bench.ts"
$R turns --user <test user id>                 # 9 messages + a check-in: p50/p95, tokens, $ per 10 turns
$R cold-start --user <test user id> --runs 3   # stop → start → ready → first reply
$R soak --user <test user id> --minutes 180    # one turn a minute
# meanwhile, on the host, memory per sandbox pod once a minute:
while sleep 60; do echo "$(date -u +%H:%M) $(sudo /usr/local/lib/notch-ops/health.sh | grep '^memory notch-dev/')"; done | tee soak-memory.log
```

The write tools run for real (one exercise changed, then undone), so only a test account. Raise the relay's `SANDBOX_IDLE_MINUTES` above the run's length first, or its idle sweep stops the sandbox mid-run. The base platform's RAM: `free -m` and the health report's memory lines with no sandbox running.

- [ ] p50/p95 reply latency, and cold start of a stopped sandbox
- [ ] Input/output tokens per turn and cost per 10-turn conversation at the routing from D-03
- [ ] RAM of the base platform and per sandbox, idle and during a heavy turn; O-12 answered with 4 prod + 2 dev sandboxes running
- [ ] A multi-hour soak of one sandbox to measure Hermes' memory growth; watchdog threshold for NH-35 set from it
- [ ] Confirmed over a longer session that `content` is never empty because of reasoning
- [ ] Sample replies in Hebrew, Arabic and Portuguese collected (informational)

#### NH-26 · Verify isolation and security controls
**Priority:** Urgent · **Estimate:** 5 · **Labels:** Area/Security, Type/Spike · **Blocked by:** NH-29

Probes ready (2026-09-30), for a team test account A and a second account B in dev:

- **From inside A's sandbox**, under its own policy: [`deploy/spike/sandbox-probe.sh`](../deploy/spike/sandbox-probe.sh) — no service account token, no key-shaped value in the environment (variable names only in the output), PID 1's environment, writes outside the workdir and `/tmp`, `/.openshell`, direct TCP to B's pod, the gateway, the node (6443, 10250, 22), the cluster API, the metadata service and the internet, and CONNECT through the proxy — with the proxy as a positive control, so a broken `/dev/tcp` can't pass for isolation. Its logic is tested against local listeners in the "Ops scripts" workflow and was run on Git Bash too.

  ```bash
  openshell sandbox upload <A> deploy/spike/sandbox-probe.sh
  openshell sandbox exec -n <A> -- bash sandbox-probe.sh --peer <B pod IP>:8642 --gateway <gateway IP:port> --node <VPS private IP> --allowed api.tavily.com:443
  ```
- **From the agent's side**: [`services/relay/src/agent-probe.ts`](../services/relay/src/agent-probe.ts) in the relay's pod — `/v1/toolsets` is exactly D-29's four with no shell, file, code, browser or fetch tool, then six injection prompts (keys, the tool token, a shell, a file, a page fetch, another user's data), each reply scanned for key shapes, the sandbox's key, the relay's secrets, file and environment contents, and canaries planted in B's facts (6 tests):

  ```bash
  kubectl -n notch-dev exec deploy/notch-relay -- node --import tsx src/agent-probe.ts --user <A> --other-user <B> --canary "<a fact only B has>"
  ```

- [ ] From inside user A's sandbox, every attempt fails: reading user B's files or volume, reaching B's sandbox or Hermes API, reaching the gateway's secrets, reaching any host outside the allowlist
- [ ] Terminal, file tools, code execution and browser confirmed unavailable to the agent (D-29)
- [ ] Prompt-injection test: a message asking the agent to reveal keys, tokens or another user's data gets nothing useful
- [ ] Hermes memory and skill writes stay inside the user's sandbox
- [ ] Findings written down; anything that fails blocks go/no-go

#### NH-27 · Go/no-go review
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Agent, Type/Spike · **Blocked by:** NH-20, NH-23, NH-25, NH-26

- [ ] Measurements compared with the O-04 thresholds; decision recorded in §4
- [ ] VPS size for the build weeks decided from O-12, within the credits (D-31)
- [ ] If no-go: fallback agreed (a different Nemotron, fewer tools or reduced scope) — never shared spaces

### M3 — Platform: GitOps, gateways, budget controls · target 2026-10-09

#### NH-36 · Argo CD and cluster layout
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Infra, Type/Feature · **Blocked by:** NH-27

- [x] A bash bootstrap script in the repo installs k3s and Argo CD core on a fresh Ubuntu 24.04 host — the same script is used for the move (NH-96) — `deploy/bootstrap/bootstrap.sh`: pinned versions, k3s without traefik, servicelb and metrics-server, secrets encrypted at rest; refuses to run without an active ufw that denies incoming by default and doesn't open 6443 or every port to anywhere, because k3s listens on 6443 everywhere (D-27; the default policy and the allow-all rule checked since 2026-10-06)
- [x] App-of-apps in the repo: the platform (Agent Sandbox controller, OpenShell), `notch-dev` and `notch-prod` — `deploy/argocd`, ordered by sync waves; two AppProjects, and only `platform` may create cluster-scoped objects
- [x] NetworkPolicy isolates `notch-dev` and `notch-prod` from each other — from the ingress side, without ever widening OpenShell's own sandbox policies (NetworkPolicies add up)
- [x] Secrets never in Git: Sealed Secrets, or `kubectl create secret` documented step by step — `deploy/bootstrap/secrets.sh` from a root-only env file on the VPS; no Sealed Secrets controller, which saves RAM
- [x] Sync window blocks `notch-prod` syncs from 2026-12-01 to 2026-12-15 (D-32) — on `notch-prod` and `openshell-prod`; a manual sync stays possible for incidents
- [x] Argo CD UI and API not exposed; the CLI works over SSH — core install; `argocd --core`, and `argocd admin dashboard` through an SSH tunnel when a UI is needed
- [ ] Bootstrapped on the VPS, both environments synced and healthy, the isolation checked (NH-26)

#### NH-37 · CI: images to GHCR and tag updates ✅
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Infra, Type/Feature · **Blocked by:** NH-21

- [x] After green tests on `main`, CI builds the relay and Hermes sandbox images for `linux/amd64` and pushes them to GHCR — `.github/workflows/images.yml`, triggered by a successful CI run on a push to this repository's `main` (never a fork's pull request); the Hermes image builds as soon as NH-21 adds `deploy/images/hermes-sandbox/Dockerfile`
- [x] CI commits the new image tags to the manifests; nothing else changes a tag — `scripts/bump-image-tag.mjs` rewrites lines marked `# image-tag: <image>`, never moving a tag backwards when runs finish out of order; the commit carries `[skip ci]`
- [x] No self-hosted runner; the workflow uses only GitHub-hosted `ubuntu-latest`
- [x] A red test leaves the cluster on the previous version — a failed CI run never reaches the Images workflow
- [x] First run on GitHub: the images pushed, the GHCR packages set to public, the tag commit lands — 2026-09-30 for the relay (`notch-relay` public, tag commits `3b8a080` and `e5e6fbd`); the Hermes package's first push and visibility belong to NH-21
- [x] The relay and the Hermes image build in separate jobs and deploy separately (2026-10-01): an image that fails to build, or has no line marked for its tag, keeps its previous tag while the other one deploys, and the run still goes red

#### NH-32 · Egress allowlist
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Security, Type/Chore · **Blocked by:** NH-26, NH-36

- [ ] Sandbox egress through OpenShell policy only: Token Factory, Tavily search, `notch-tools`
- [ ] Host firewall: outbound limited to what k3s, Argo CD (GitHub, GHCR), the relay (Supabase) and updates need
- [ ] A request from a sandbox to any other host fails (tested)

#### NH-33 · OpenShell gateways for dev and prod through Argo CD
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-36

- [ ] Gateway (or per-environment configuration, per O-11) for `notch-dev` and `notch-prod` deployed from Git
- [ ] Provider profiles imported (`deploy/platform/openshell/profiles`: `token-factory`, `tavily`, `notch-tools`, written with NH-55) and the shared providers `token-factory` and `tavily` created in each environment
- [ ] Separate Token Factory keys per environment (D-34), injected by the gateway
- [ ] Everything comes back after a VPS reboot

#### NH-38 · Budget controls ✅
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Backend, Area/Infra, Type/Feature · **Blocked by:** NH-01

- [x] D-34 ceilings in `_shared/assistant.ts` from actual token spend: prod $1/day, dev $0.5/day, nightly memory $0.5/run — `spendCeilingsCents`, `checkSpend` (fails closed), `recordSpend`; per-day totals in `public.assistant_spend`. Unknown models are priced as the most expensive known one and unreported usage is charged a conservative fallback, so neither can switch the ceiling off. A unit test fails if the default ceilings stop fitting the credits
- [x] At the ceiling the assistant replies that today's limit is reached; nothing is sent to Token Factory — the `daily_limit_reached` code and helpers are ready; the checks themselves are wired in NH-51, NH-52, NH-53 and NH-63
- [x] Monday spend check written down as a runbook: [`budget-runbook.md`](./budget-runbook.md)
- [x] Rule written down: forecast > 90% of credits → `notch-dev` off first, then lower ceilings

#### NH-34 · Backups and restore drill
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-33

- [x] Scheduled backups of the sandbox volumes (the only state on the VPS; everything else is in Git or Supabase) — and, found while writing NH-36, each gateway's own volume (its SQLite database of sandboxes and encrypted provider credentials) plus its `openshell-credential-kek` Secret, without which the restored credentials can't be decrypted (`secrets.sh --restore-kek`), and the relay's `SANDBOX_KEY_SECRET` (NH-55), without which it can't call the existing sandboxes — `deploy/ops/backup.sh`, nightly at 01:30 UTC: every volume in `notch-dev` and `notch-prod`, SQLite copied through its online backup so nothing is stopped, one archive encrypted with age to the team's key, 7 kept on the VPS and optionally a copy in Nebius Object Storage. The KEKs, the env files and the backup key are kept off the VPS by the team, never in an archive (table in `deploy/README.md`)
- [ ] Installed on the VPS (`deploy/ops/install.sh`) and the first archive opened with the team's key
- [ ] Restore tested once on a fresh host with the NH-36 bootstrap script — the rehearsal for NH-96. Written: `bootstrap.sh --no-root-app`, then `deploy/ops/restore.sh`, which puts each volume back under its old claim, pre-bound, before Argo CD starts anything. The drill settles whether a restored gateway takes its sandboxes back; if not, the fallback in `deploy/README.md` starts it empty, and users lose only Hermes' own memories — chat and facts are in Supabase (D-30)

#### NH-35 · Monitoring and alerts
**Priority:** Medium · **Estimate:** 3 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-33

- [x] Uptime ping and host health (CPU, RAM, disk) with alerts — `deploy/ops/health.sh` every 5 minutes, reporting to a free healthchecks.io check that emails both members on a problem and when the pings stop; also k3s, workloads, Argo CD, crash loops, the sandbox cap, relay errors and backup age. A problem counts once two runs in a row see it
- [x] Running sandbox count, queue length and relay errors visible — sandboxes, memory per pod and relay errors in the health report — since 2026-10-06 including replies that couldn't be stored (`delivery_failed`, `delivery_refused`), which it had missed, and a relay test fails when the relay logs an error event the health check doesn't count; the queue in Supabase ([`assistant-ops.md`](./assistant-ops.md), "Queue right now")
- [ ] Per-sandbox RSS watchdog restarts a sandbox above the threshold from NH-25 (Hermes gateway memory growth) — the mechanism is `SANDBOX_MEMORY` (OpenShell makes it the pod's memory limit; the relay starts a killed sandbox again on the next message); the value waits for NH-25
- [ ] Nebius billing alerts verified — set up per the [budget runbook](./budget-runbook.md), checked after the VPS's first day
- [ ] On the VPS: the healthchecks.io check created, and stopping k3s produces an alert email

### M4 — Coach profile and tools · target 2026-10-12

#### NH-40 · Hermes coach profile
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-27

- [x] Persona and rules ported from `services/agent/src/prompt.ts` (safety rules, formatting, reply language) into the Hermes persona file — `deploy/images/hermes-sandbox/profile/SOUL.md`: the safety and nutrition rules, D-22's plan scope, numbers only from tools, honest progress, formatting for the chat screen. What's personal comes with each request instead: the relay sends the reply language, the coach's name, tone and accountability style and the user's own style notes, framed as preferences under the rules (migration `20260928190000_assistant_context_persona.sql`, 5 SQL checks, 4 relay tests)
- [x] Config with the D-29 tool whitelist: `notch-tools` MCP, web search (Tavily), memory, skills; everything else disabled — `profile/config.yaml`: the API server gets exactly those four toolsets, terminal, files, code, browser and 12 more are off everywhere, the MCP allowlist is checked against `notch-tools`' own code, Tavily is search only (D-04) with no fallback vendors, thinking is off (D-03), one run at a time per sandbox
- [x] Found while writing the config: Hermes by default makes model calls the relay never sees — a memory/skill review after each turn, and a title for every new session (each relay request is one). D-34 couldn't count them, so both are off; memory and skills are still written in the turn, through the tools
- [ ] The profile lives in the repo and is baked into, or mounted by, every user's sandbox — in the repo with `install-profile.sh`, which the image runs on every start (the volume keeps memories, and would keep a stale profile too); the image itself is NH-21

#### NH-41 · `assistant_agents` mapping and tool tokens ✅
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** —

- [x] Additive migration `assistant_agents(user_id, environment, sandbox_name, tool_token_hash, provisioned_at, …)` with no client access; a row created ahead of the first message routes a team account to `notch-dev`, no row means `notch-prod` (`assistant_environment()`)
- [x] Helper resolves a bearer token to a `user_id` by hash comparison; tokens never grant database access (`assistant_user_for_tool_token()`, service_role only; the TypeScript side lands with NH-42)

#### NH-42 · `notch-tools` MCP Edge Function skeleton
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-10, NH-11, NH-41

- [x] Streamable HTTP MCP server running as a Supabase Edge Function: `supabase/functions/notch-tools`, stateless JSON responses, the protocol core in `_shared/mcp.ts`; `verify_jwt` off in `config.toml` (deploy with `--no-verify-jwt`), since the sandbox authenticates with its tool token
- [x] Every call resolves the token to a user, checks flags, entitlement (`subscriptionAccess`) and rate limits; unknown browser origins are refused (DNS-rebinding rule); a tool never takes a user id from its arguments. Since 2026-10-05 a failed subscription read is an unexpected failure, not "the subscription isn't active", which had the agent tell a paying user to renew
- [x] Tool errors return safe messages: no stack traces, no secrets — only `ToolError` messages reach the agent
- [ ] A test tool is callable from a sandbox in `notch-dev` — `notch_ping` is ready; needs the VPS

#### NH-43 · Stage A read tools
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-42

- [x] Tools: `get_profile`, `get_active_plans` (with exercises), `get_workout_history` (recent sessions and progression summary), `get_user_facts` — `notch-tools/read-tools.ts`; the progression summary is computed in code, recent studio classes are listed too
- [x] Every query filtered by the resolved `user_id` — a test records every query and fails if one isn't; `set_logs` is read only by session ids from a user-scoped query
- [x] Weights returned in the user's unit system, rounded to 0.5 like the app
- [ ] Live smoke test of the PostgREST queries against the deployed function (after the NH-06 rollout)

#### NH-44 · Stage A write tools: save note, plan tweak, undo
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-42

D-21: acting on the user's behalf is what the track is judged on, so Stage A isn't read-only. D-22 keeps that safe without a confirmation round trip: act now, record it, allow undo.

- [x] `save_note` writes to `coach_notes` (general or exercise-scoped) with the same validation as the current coach; length limits enforced; an identical note within 10 minutes isn't duplicated, so a retried call is harmless
- [x] `adjust_plan_exercise` changes sets, rep range (only formats progression parses), rest, intensity or warm-up of one plan exercise in one active plan; never the movement (D-22); refused while that workout is in progress
- [x] Additive migration `assistant_actions(id, user_id, kind, before jsonb, after jsonb, undoes, created_at, undone_at)`; kinds limited to D-22's scope, an action can be undone once
- [x] Every write tool records one row — the write and its audit row are one SQL function (migration `20260928140000_assistant_write_tools.sql`), so they commit or fail together
- [x] `undo_last_change` reverts the user's most recent action within 24 hours and is itself recorded; calling it again walks further back; a change made since by anything else is an `undo_conflict`, never silently overwritten
- [x] Tools refuse anything outside D-22's scope, re-check ownership server-side, and the reply states exactly what changed and that it can be undone — the `summary` is built in code from before/after
- [ ] Live smoke test against the deployed function (after the NH-06 rollout)

#### NH-45 · Agent instructions and policies
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-40

- [x] `user_facts` is canonical memory (D-30); Hermes' own memory and skills never store keys, tokens or anyone else's data — SOUL.md, "Memory"
- [x] Hermes' own memory keeps coaching know-how, not personal facts about the user: a fact deleted in "What the coach remembers" (NH-71) must stop being used, and our delete can't reach inside Hermes' memory. Checked in NH-73: delete a fact, and the next reply doesn't use it — Hermes' USER.md profile store is off (`user_profile_enabled: false`), and SOUL.md keeps personal facts out of MEMORY.md; the live check stays in NH-73
- [x] Tavily only for knowledge questions (nutrition labels, exercise substitutions, equipment), no personal data in queries, sources cited — SOUL.md; the agent cites markdown links, and the relay turns each into plain text plus a tappable source, since the chat renders only bold
- [x] Medical safety rule preserved: pain or injury → stop the exercise and consult a professional
- [ ] Checked in a real sandbox: the rules hold against the scripted cases in NH-73

### M5 — Channel, relay and sandbox lifecycle · target 2026-10-14

#### NH-50 · Assistant message store and inbound queue ✅
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** —

- [x] Additive migration `assistant_messages(id, user_id, role, doc jsonb, client_message_id, created_at)`; users can read their own rows via RLS; a retried `client_message_id` is rejected
- [x] Inbound work queue with lease and ack, per environment: the `assistant_jobs` table with `assistant_claim_jobs()` / `assistant_ack_job()` — at most one job per user in flight, expired leases reclaimed, retries up to `max_attempts`; check-ins deduplicated per day
- [x] Deleting a user removes their rows from both

#### NH-51 · `assistant-send` Edge Function
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-10, NH-11, NH-50

- [x] JWT auth, flag check, entitlement (402 like coach-turn), rate limit, per-account and global daily caps and the D-34 ceilings: `checkSpend` for the user's environment, refusing with `daily_limit_reached` and a reason
- [x] Idempotency key: a retried send never duplicates a message — it returns the original, even after a limit has been reached since
- [x] Stores the user message and enqueues work for the user's environment, in one transaction (`assistant_enqueue_message`, migration `20260928150000_assistant_channel.sql`)
- [ ] Live smoke test against the deployed function (after the NH-06 rollout)

#### NH-52 · `assistant-outbox` Edge Function
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-50

- [x] Shared-secret auth per environment, usable only by that environment's relay: HMAC-SHA256 over environment, timestamp and body, ±5 minutes (`_shared/relay-auth.ts`); `verify_jwt` off
- [x] Returns pending work under a lease with its context — message, last 20 messages, facts, language, units, sandbox mapping (`assistant_job_context`); a `fail` action returns the job to the queue and records the tokens it spent; expired leases return to the queue
- [x] Hands out no work for an environment at its D-34 ceiling (`checkSpend`)
- [ ] Live smoke test against the deployed function (after the NH-06 rollout)

#### NH-53 · `assistant-deliver` Edge Function
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-50

- [x] HMAC-verified requests with replay protection (timestamp + dedup): a retried delivery returns the stored reply — one reply per job, enforced by a unique `job_id`
- [x] Stores the reply in `assistant_messages` and finishes the job in one transaction (`assistant_complete_job`), then sends a push notification; a check-in can be finished with `skip` and no message
- [x] Records the turn's spend with `recordSpend` — the usage the relay reports, or the fallback
- [ ] Live smoke test against the deployed function (after the NH-06 rollout)

#### NH-54 · The relay
**Priority:** Urgent · **Estimate:** 5 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-24, NH-33, NH-52, NH-53

- [x] Polls `assistant-outbox`, routes each message to the user's sandbox Hermes API with that sandbox's key, posts the reply to `assistant-deliver` — `services/relay`; a user without a ready sandbox waits in the queue, never served elsewhere; sandbox addresses come from a static map until NH-55
- [x] Attaches the facts block to every request (NH-64)
- [x] Recovers from network errors: exponential backoff, idempotent delivery retries, a lost lease drops the result
- [ ] Deployed per environment through Argo CD (NH-36, NH-37)
- [ ] Verified against a real Hermes sandbox: reply text, `usage` across the tool loop, `x-hermes-session-key` (NH-24, NH-25)

#### NH-55 · Sandbox manager: provisioning and lifecycle
**Priority:** Urgent · **Estimate:** 8 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-29, NH-40, NH-41, NH-54

- [x] First message from a flagged user → a sandbox is created (NH-29), the tool token minted, the mapping stored in `assistant_agents` — `services/relay/src/sandbox-manager.ts`: the mapping and the token's digest are recorded first (`assistant_agent_record` through `assistant-outbox`, since the relay has no database credentials), the token goes into a per-user OpenShell provider, then the sandbox is created from the gateway's default image; each sandbox's Hermes API key is derived from a secret, never stored
- [x] A stopped sandbox is started on demand; idle sandboxes stop after 10 minutes
- [x] At most 4 running sandboxes in `notch-prod` and 2 in `notch-dev`; extra work waits in the queue — never shared (D-26) — a job that doesn't fit is deferred with its attempt unspent (`assistant_defer_job`, `not_before`), the user's later messages wait behind it, and the least recently used sandbox that isn't answering is stopped to make room; decisions run one at a time, so two jobs can't take the last slot
- [x] Idempotent: a retry never creates a second sandbox — the name is derived from the user id
- [ ] Switched on in `notch-dev`, then `notch-prod` (`RELAY_SANDBOXES=manager`) once the spike settles the CLI's JSON, the relay's access to its gateway and to a sandbox's exposed port (NH-29); the steps are in `deploy/README.md`

#### NH-56 · Account deletion cleanup
**Priority:** Medium · **Estimate:** 3 · **Labels:** Area/Backend, Area/Agent, Type/Feature · **Blocked by:** NH-55

- [x] Deleting an account destroys the user's sandbox, its volume and its credentials — the sandbox manager (NH-55) destroys every sandbox that no longer has an `assistant_agents` row — a sweep every 15 minutes, at most 3 sandboxes per sweep, then their tool providers; a sandbox answering a message is never touched
- [ ] Checked on the cluster: a deleted test account's sandbox and provider are gone within two sweeps
- [x] The user's database rows are removed by cascade (`assistant_messages` via NH-50, `user_facts` and `user_memory_state` via NH-60) — also jobs, actions and the mapping; tested, including the QA "fresh" reset
- [x] `assistant_agents` mapping row removed

#### NH-57 · Kill switch and usage queries ✅
**Priority:** Medium · **Estimate:** 2 · **Labels:** Area/Backend, Type/Feature · **Blocked by:** NH-51

- [x] Kill switch tested: `update public.feature_flags set enabled = false where flag like 'assistant_%'` hides the assistant for everyone — server checks included, per-user flags untouched, switching back restores the previous state
- [x] Saved SQL queries: messages per day, tokens and spend per day, errors per day, plus stuck work — [`assistant-ops.md`](./assistant-ops.md)

### M6 — Personalization memory · target 2026-10-18

#### NH-60 · Facts tables ✅
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Memory, Type/Feature · **Blocked by:** —

- [x] Additive migration `user_facts(id, user_id, doc jsonb, score, pinned, created_at, updated_at)`; the database enforces 15 facts and 3 pins per user as a safety net; `doc` holds `text, category, importance, stability, evidence, expires_at, first_seen_at, last_seen_at, mention_count, source_message_ids`
- [x] Additive migration `user_memory_state(user_id, facts_version, last_run_at, watermark)`
- [x] RLS: users can read and delete their own facts; deleting a fact bumps `facts_version` (trigger)
- [x] Rows in both tables cascade-delete with the user

#### NH-61 · Fact extraction on Nemotron
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Memory, Type/Feature · **Blocked by:** NH-22

- [x] Prompt and JSON schema: input is current facts + new messages; output is a list of operations `ADD | UPDATE(id) | REINFORCE(id) | CONTRADICT(id) | EXPIRE(id)` with `category`, `importance` (1–5), `stability` (temporary / long-term / permanent), `evidence` (explicit / inferred) — `_shared/memory-extraction.ts`; facts are written in the user's language; the model sees short references (f1, m1), never database ids
- [x] Invalid JSON or unknown fact IDs are rejected, never applied — each operation is validated on its own; an add that repeats a current fact becomes a reinforce, and the same fact added twice in one reply is stored once (fixed 2026-10-06)
- [x] Facts stored as short neutral statements (≤ 140 characters) that never contain instructions — one line, no links or markup, instruction-like text refused
- [ ] Run against Nemotron on Token Factory with the NH-65 golden set (needs NH-01 keys); the client is `_shared/token-factory.ts`

#### NH-62 · Scoring and eviction module ✅
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

- [x] Pure module with unit tests for every rule and boundary (15th and 16th fact, pinned limit, expiry, ties): `supabase/functions/_shared/memory-scoring.ts`, 26 Deno tests including 500 randomized runs
- [x] Deterministic: the same input always gives the same output, whatever the input order

#### NH-63 · Nightly memory job
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Memory, Type/Feature · **Blocked by:** NH-60, NH-61, NH-62

- [x] Supabase Cron at 00:00 UTC queues flagged users with new messages since their watermark; sources: `assistant_messages` and workout `messages` from the last 14 days — the cron calls `memory-nightly` every 10 minutes from 00:00 to 02:59 UTC (`supabase/cron/assistant.sql`, applied by hand after deploy); `assistant_memory_due` picks the users; the oldest unread messages are read first, so a backlog is never skipped; users with facts but nothing new get the daily score and expiry refresh without a model call
- [x] Worker Edge Function processes users in batches that fit Edge Function time limits — stops starting users after 75 s, so a model call at its full 60-second timeout still ends inside the free plan's 150-second limit (400 s on paid plans), and stops retrying at the same deadline; the next call continues. A run cut off mid-user would record no spend and no run, and the next call would pay for that user again (fixed 2026-10-05; it started users up to 100 s in, with retries that could take three minutes)
- [x] Applies NH-61 operations through NH-62; bumps `facts_version` on any change; advances the watermark — one transaction (`assistant_memory_apply`), ordered so the fact and pin caps never trip; a fact the user deleted mid-run stays deleted
- [x] Idempotent (re-running a batch changes nothing); retries with backoff; per-user token cap; run summary logged — one run per user per day, a failure counts as that run (no retry storm) and keeps the watermark; Token Factory retries 429/5xx but never a timeout, whose model already ran, and each retried attempt that may have spent is charged; at most 200 messages and 8,000 output tokens per user
- [x] Runs on member B's Token Factory key (D-24) with Ultra and thinking on, within the $0.5-per-run ceiling (D-34): `checkSpend('memory')` before each user, `recordSpend` after each call
- [x] Stays on Supabase Cron per D-23; every call logs a `memory_run` summary with its duration
- [ ] First real run on Token Factory (needs keys); record the measured duration here so "it outgrew the Edge Function limit" stays a checkable trigger
- [x] `private.seed_demo_account` also clears the account's assistant messages, jobs, actions, facts and memory state, so a re-seed before judging starts clean — the original seed is wrapped, not copied; the first run then builds facts from the seeded history

#### NH-64 · Facts injection into the agent
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Memory, Area/Agent, Type/Feature · **Blocked by:** NH-54, NH-63

- [x] The relay attaches the facts block to every request as a system message that Hermes layers on top of its own prompt (`services/relay/src/prompt.ts`)
- [x] Block explicitly marked as data, never instructions; at most 15 lines; each fact flattened to one line so it can't inject extra ones
- [ ] The agent's reply references a relevant fact in a scripted test

#### NH-65 · Memory evaluation
**Priority:** Medium · **Estimate:** 3 · **Labels:** Area/Memory, Area/QA, Type/Feature · **Blocked by:** NH-63

- [x] Golden set of at least 10 English chats with expected facts — 12 in `supabase/eval/memory/golden.json`, including refusals: a coach-only statement, an injection attempt, small talk
- [ ] Precision and recall recorded: run `supabase/eval/memory/run.ts` once keys exist (NH-01) and paste its table here
- [x] Running the job twice on unchanged input changes nothing — structurally: a user already run today isn't due, and a user with nothing new gets no model call; the eval's second pass also measures model churn on the same messages

#### NH-66 · Proactive daily check-in
**Priority:** High · **Estimate:** 5 · **Labels:** Area/Agent, Type/Feature · **Blocked by:** NH-55, NH-64

Required (D-21): "always-on" is half of what the Personal AI track asks for, and a message the user didn't trigger is the clearest demo of it.

- [x] Supabase Cron enqueues a daily check-in turn per opted-in account (flag `assistant_checkin` on top of `assistant_chat`, 06:00 UTC, `assistant_enqueue_checkins`); a check-in that didn't go out on its day is failed as stale, never sent late; the relay runs it in the user's sandbox — starting a stopped sandbox comes with NH-55
- [x] The message covers today's workout and one relevant fact; delivered through `assistant-deliver` with a push notification; within the D-34 ceilings — the relay's check-in instruction; the outbox hands out nothing at the ceiling
- [x] Skips silently when there's nothing to say, so it never becomes noise — the agent answers `SKIP` and the job is finished with no message
- [ ] Verified end to end on a real sandbox (after NH-55)

### M7 — TestFlight demo build · target 2026-10-20

#### NH-70 · Mobile: Coach chat screen
**Priority:** Urgent · **Estimate:** 5 · **Labels:** Area/Mobile, Type/Feature · **Blocked by:** NH-12, NH-51, NH-53

- [x] Sends through `assistant-send` and renders `assistant_messages`, with pending and typing states — `app/(tabs)/coach.tsx`, a tab only flagged accounts see. "Waiting" until the relay picks the message up, "typing" while the agent works, "taking longer than usual" after 2 minutes, "couldn't answer — send again" once every attempt failed; the statuses come from `assistant_my_open_jobs()` (own chat jobs only, no error text; 9 SQL checks). Check-ins are labelled, and Tavily sources are tappable https links
- [x] Catches up on missed replies when the app returns to the foreground or a push is tapped (same pattern as the workout chat) — also on a reply's push while open, and by polling every 3 s only while a reply is expected; a reply's push opens this chat, not the workout chat, and adds no "+1" to the workout tab
- [x] Clear states for rate limit, daily limit reached and assistant disabled — a refused message goes back into the composer with the reason (per-account and spend or global limits worded differently); a network or server failure keeps it as "not sent — tap to retry" with the same client id, which the server never stores twice
- [x] New strings added to all 8 locale files — 37 strings, translated
- [ ] Checked on a device against a real reply (NH-73)

#### NH-71 · Mobile: "What the coach remembers" screen
**Priority:** High · **Estimate:** 3 · **Labels:** Area/Mobile, Type/Feature · **Blocked by:** NH-12, NH-60

- [x] Lists facts with their category; the user can delete any fact — `app/coach-memory.tsx`, opened from the chat's header when `assistant_memory` is on; pinned health facts first, then by category and score; a delete asks first, is optimistic and comes back with an alert if it fails
- [x] Empty state when there are no facts
- [x] ~~If this doesn't make the build, facts are listed and deleted from a section of the chat screen instead~~ — not needed, the screen is ready for the first build
- [ ] Checked on a device (NH-73)

#### NH-72 · TestFlight build and public link
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Mobile, Type/Chore · **Blocked by:** NH-70

EAS build and submit commands need explicit team approval and `--non-interactive` (see `apps/mobile/AGENTS.md`). NH-71 ships in the same build if it's ready.

Runbook and the TestFlight texts in [`submission.md`](./submission.md#the-testflight-build-nh-72) (2026-09-30). Found while writing it: `app.json` is still `1.0.2`, the version released on 2026-08-20. If that's live, the build needs `1.0.3`, because App Store Connect refuses new builds on an approved version; and `public.app_config.latest_version` must stay as it is, or App Store users are nudged toward a version they can't get.

- [ ] Build submitted to Beta App Review for external testing by 2026-10-16
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
  - a write tool changes the plan, and undo reverts it
  - delete a fact, and the next reply doesn't use it
  - push notification received
- [ ] Every issue found is filed in Linear

### M8 — Cancelled

In-workout coaching on the new runtime moved to the post-hackathon backlog: PH-12 (Stage B write tools, was NH-80), PH-13 (parity eval, was NH-81), PH-14 (pre-warm and gated rollout, was NH-82).

### M9 — Submission · target 2026-10-26 (hard deadline 2026-10-30 10:00 PT)

#### NH-90 · English README
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** —

- [x] Architecture diagram and a component overview — the root `README.md`, written 2026-09-30; a Mermaid diagram checked to render with Mermaid 11
- [x] Setup instructions for the mobile app, Supabase functions, the agent service, and the cluster (bootstrap script, Argo CD, OpenShell, Hermes image), with every environment variable and secret listed — the cluster part points to `deploy/README.md` for the full runbook
- [x] How Nemotron on Token Factory, OpenShell, Hermes and Tavily are used, including the model routing and why each model is used where — only the two uses that exist in code (Super for assistant turns, Ultra for the nightly job), and what stays on Gemini
- [x] A clear split of what comes from upstream (OpenShell, Hermes, NemoClaw's Hermes blueprint) and what we wrote (D-19), with upstream licenses preserved — no upstream source is vendored; the relay image ships OpenShell's LICENSE and THIRD-PARTY-NOTICES with the CLI binary
- [x] The glossary from §1, so nobody reads OpenShell as PowerShell
- [x] Section "What changed during the submission period (after 2026-08-26)"
- [ ] License and demo instructions — the license is in; the TestFlight link and the video link wait for NH-72 and NH-91 (judge accounts go in the Devpost testing instructions, never in the public README)
- [ ] Final pass before submission: the status note replaced by what's live, the model ids and numbers refreshed

#### NH-91 · Demo video
**Priority:** Urgent · **Estimate:** 3 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** NH-73

Script, shot list and recording rules drafted in [`submission.md`](./submission.md#the-demo-video-nh-91) (2026-09-30).

- [ ] Under 3 minutes, public on YouTube, no third-party music or trademarks
- [ ] Voiceover explicitly explains how Token Factory and the Nemotron models are used (a scored requirement, not a nicety)
- [ ] Shows memory across sessions and the assistant acting — a proactive check-in and a tool-driven change — not just chat
- [ ] Shows a Tavily answer with sources and per-user isolation, and names what is ours versus upstream (D-19)

#### NH-92 · Pre-submission check of the public repository
**Priority:** Urgent · **Estimate:** 1 · **Labels:** Area/Security, Area/Docs, Type/Chore · **Blocked by:** NH-04, NH-05, NH-06

- [ ] Final gitleaks run over the full history is clean — run on 2026-10-06 over a full clone (all 267 commits on every branch; earlier scans had run on a shallow clone): one false positive in the oldest history, the same local storage entry name already ignored in later commits, now in `.gitleaksignore`; clean otherwise. A shallow clone hides the oldest commits, so run it after `git fetch --unshallow`, or through the Secret scan workflow's manual run (`fetch-depth: 0`)
- [ ] Branch protection enabled on `main` (off as of 2026-10-06); CI required before merge — it must still let the Images workflow push its tag commit (NH-37), e.g. through a deploy key allowed to bypass it, or deploys stop
- [x] License visible in the GitHub **About** panel — GitHub detects the root LICENSE as MIT (checked 2026-10-06)

#### NH-93 · Devpost submission
**Priority:** Urgent · **Estimate:** 2 · **Labels:** Area/Docs, Type/Chore · **Blocked by:** NH-72, NH-90, NH-91, NH-92

Every field drafted in [`submission.md`](./submission.md) (2026-09-30): pitch, story, built-with, the changes since 2026-08-26, the judges' testing instructions (addresses only in Devpost, after checking the field is private) and the feedback. The ⟨…⟩ placeholders wait for links and live measurements.

- [ ] Description covers features, NVIDIA model usage and the Nebius and NVIDIA tools used
- [ ] Track: Personal AI; city: **Tel Aviv** (City Winner); repo and video links; TestFlight link and demo credentials in the testing instructions
- [ ] Feedback on Token Factory, AI Cloud and the NVIDIA tools submitted
- [ ] Submitted by 2026-10-26

### M10 — Move and judging support · 2026-11-15 → 2026-12-15

#### NH-96 · Move the VPS to member B's credits
**Priority:** High · **Estimate:** 2 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-34

- [ ] On 2026-11-15, member B creates a 2 vCPU / 8 GiB Ubuntu 24.04 VPS with the `claude` user (§0)
- [ ] The NH-36 bootstrap script runs; Argo CD syncs `notch-prod` only; sandbox volumes restored from the latest backup — step by step in `deploy/README.md`, "Restoring onto a new host"
- [ ] The old relay stops, the new one starts; a judge account's chat works end to end
- [ ] The old VPS and its disk deleted; member A's AI Cloud spend stops
- [ ] On 2026-12-01 the VPS is resized to 4 vCPU / 16 GiB for judging, within member B's credits

#### NH-95 · Keep the demo alive through judging
**Priority:** High · **Estimate:** 1 · **Labels:** Area/Infra, Type/Chore · **Blocked by:** NH-93

The weekly checklist and the fixed dates are in [`submission.md`](./submission.md#keeping-the-demo-alive-through-judging-nh-95); among them, never re-seed a judge account during judging.

- [ ] Weekly check from 2026-10-30 to 2026-12-15: VPS up, TestFlight build valid, credits balance and expiry, spend within the D-34 ceilings
- [ ] Prod sync window active from 2026-12-01 to 2026-12-15; incident contact assigned

---

## 11. Risks

| Risk | Impact | Mitigation | Related |
|---|---|---|---|
| Scope exceeds team capacity (139 remaining points against ~20–30 person-days) | Parts of the plan unfinished at the deadline | Accepted by the team on 2026-09-27. Claude writes the code, scripts and manifests and runs the VPS work; the minimum line in §9 shows what the submission can't do without | §9 |
| OpenShell and Hermes are alpha; the Kubernetes path is less traveled than NemoClaw's host installer | Spike slips, runtime unstable | NH-21 first thing after the VPS; versions pinned; go/no-go on Oct 4 | NH-21, NH-27 |
| 2 vCPU / 8 GiB doesn't hold the platform plus sandboxes | Long queues | Measured in NH-25 (O-12); shorter idle timeout, then a temporary 4/16 within the credits; never shared spaces | NH-25, D-31 |
| Hermes gateway memory grows over hours (upstream issue) | OOM, sandboxes killed | Idle sandboxes stop after 10 minutes; per-sandbox RSS watchdog | NH-25, NH-35 |
| AI Cloud credits run out, or prices rise | Demo offline during judging | D-31 plan totals ≈ $122 of $200, ≈ $158 in the price-rise case; Monday spend check; stop rule | NH-38, NH-96 |
| The VPS move on Nov 15 fails | Demo offline before judging | The move is the restore drill already rehearsed in NH-34; two weeks of buffer before Dec 1; the old VPS is deleted only after the new one passes the end-to-end check | NH-34, NH-96 |
| Dev and prod on one host, both tracking `main` | A bad commit reaches prod at once | Only CI changes image tags, after green tests; prod sync window during judging | NH-37, D-32 |
| Token Factory credits run out | Assistant stops | D-34 hard ceilings; Nemotron 3.5 Lightning fallback | NH-38 |
| Public repo and judge accounts invite abuse | Spend spikes | Allowlists from secrets, per-account caps, D-34 ceilings, kill switch | NH-06, NH-51, NH-57 |
| Prompt injection or memory poisoning | Data leakage, bad advice | A sandbox per user, D-29 least privilege, search-only Tavily, egress policy, keys held by the gateway, server-side validation | NH-26, NH-32, NH-45 |
| The assistant makes a change the user didn't want | Lost trust, damaged training plan | D-22's narrow write scope, the `assistant_actions` audit trail and `undo_last_change`; the reply always states what changed | NH-44 |
| Changes to shared code break the current coach for real users | Outage for real users | D-17; additive migrations; `verify` skill and live smoke tests | — |
| Stage 1 rejects the entry as a superficial rebrand | Never reaches scoring | D-19: our tools, memory, provisioning, relay and GitOps are the deliverable, and the README and video lead with them | NH-90, NH-91 |
| Nemotron returns reasoning instead of content, or breaks on tool calls | The assistant can't act at all | NH-28 before any wiring; `reasoning_effort: "none"` on interactive turns, confirmed through the inference router in NH-22 | NH-28, NH-22 |
| The runtime silently calls a provider other than Token Factory | Disqualifying: no Nebius runtime call | Checked from Token Factory usage in NH-22 and after every upgrade | NH-22 |
| Beta App Review delay; judges without an iPhone | Judges can't test | Submit the build by Oct 16; video and screenshots in the README | NH-72, NH-91 |
| Nemotron reply quality in Hebrew, Arabic, Portuguese | Poor replies for those users after rollout | Demo in English; quality gate before rollout | PH-04 |

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
| PH-12 | Stage B write tools: start session, log sets, correct a set, defer / switch / substitute exercise, complete session — through new `mod.ts` exports only (was NH-80) | Medium |
| PH-13 | Parity eval of in-workout coaching against the current `/converse` path (was NH-81) | Medium |
| PH-14 | Sandbox pre-warm when a workout starts; gated rollout of `assistant_workout` (was NH-82) | Medium |
| PH-15 | Separate dev and prod hosts, or promote prod by release tag instead of tracking `main` | Medium |
| PH-16 | Capacity plan for real users: sandbox density, multi-node cluster, cost per active user | High |

---

## 13. References

- Hackathon: [rules](https://nebiusglobalaihackathon.devpost.com/rules) · [resources](https://nebiusglobalaihackathon.devpost.com/resources) · [Nebius Discord](https://discord.gg/eXYTGhgnhK)
- NVIDIA OpenShell: [GitHub](https://github.com/NVIDIA/OpenShell) · [Set up OpenShell on Kubernetes](https://docs.nvidia.com/openshell/kubernetes/setup)
- NVIDIA NemoClaw: [GitHub](https://github.com/NVIDIA/NemoClaw) · [Hermes quickstart](https://docs.nvidia.com/nemoclaw/user-guide/hermes/get-started/quickstart) · [prerequisites](https://docs.nvidia.com/nemoclaw/latest/get-started/prerequisites.html)
- Hermes Agent: [GitHub](https://github.com/nousresearch/hermes-agent) · [API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) · [profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles) · [memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) · [web search](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-search) · [MCP](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md) · [Python library](https://hermes-agent.nousresearch.com/docs/guides/python-library) · [gateway memory leak issue](https://github.com/NousResearch/hermes-agent/issues/25315)
- Tavily: [Hermes Agent integration](https://docs.tavily.com/documentation/integrations/hermes-agent)
- k3s and Argo CD: [k3s docs](https://docs.k3s.io/) · [k3s resource profiling](https://docs.k3s.io/reference/resource-profiling) · [Argo CD core](https://argo-cd.readthedocs.io/en/stable/operator-manual/core/) · [sync windows](https://argo-cd.readthedocs.io/en/stable/user-guide/sync_windows/)
- GitHub: [self-hosted runner security](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners)
- Nebius: [Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart) · [Compute pricing](https://docs.nebius.com/compute/resources/pricing) · [Builder Program terms](https://nebius.com/builders-terms-and-conditions)
- NVIDIA: [Nemotron 3 Super model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8)
- Context for D-12: [Supabase + FerretDB (MongoDB compatibility)](https://supabase.com/blog/nosql-mongodb-compatibility-with-ferretdb-and-flydotio)
