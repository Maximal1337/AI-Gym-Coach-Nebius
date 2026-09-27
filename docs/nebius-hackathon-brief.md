# Notch × Nebius Hackathon — one-page brief

The short version of the plan, as agreed on 2026-09-27. Full detail: [`nebius-hackathon-plan.md`](./nebius-hackathon-plan.md) — decisions in §4, the first-run checklist in §0, issues in §10.

**Dates:** submission 2026-10-30 10:00 PT (we aim for Oct 26) · judging 2026-12-01 → 12-15, the demo must stay up the whole time · track: Personal AI · city: Tel Aviv.

**Names that are easy to mix up:** **NVIDIA OpenShell** is a Linux sandbox runtime for AI agents — nothing to do with PowerShell. **NemoClaw** is NVIDIA's reference stack for running agents in OpenShell; we reuse its Hermes blueprint. **Hermes Agent** is the open-source agent (Nous Research) that runs inside each sandbox.

## What we're submitting

Notch gets a personal coach that **remembers between sessions and acts on your behalf** — exactly what the track is judged on:

- **Every user gets their own Hermes agent in their own OpenShell sandbox.** Memory, skills and files are never shared; when capacity runs out, requests wait in a queue instead.
- **Our MCP tool server over the real training data:** it reads the plan and history, saves notes, swaps an exercise — every write validated server-side, logged, and undoable for 24 hours.
- **Memory:** a nightly job turns chats into typed facts, scored in code, capped at 15, passed with every request and visible to the user.
- **Tavily** for grounded answers (nutrition labels, exercise substitutions) — worth a $3,000 bonus.
- **A proactive daily check-in**, so it isn't only reactive.

Only two things are mandatory: a runtime call to **Nebius Token Factory** and at least one **NVIDIA Nemotron** model. OpenShell, Hermes and NemoClaw are the track's suggested tools. Judging stage 1 rejects "deployed an open-source project and renamed it", so the README and the video lead with what we wrote: the tools, the memory pipeline, per-user provisioning and the GitOps setup.

## How it's built

- **One Nebius VPS**, Ubuntu 24.04, a single-node k3s. Argo CD pulls from GitHub, OpenShell is installed through Helm, and `notch-dev` / `notch-prod` are separate namespaces.
- **No inbound traffic except SSH:** a relay pulls work from Supabase and talks to each user's sandbox locally.
- **Keys never enter the agent:** the OpenShell gateway injects the Token Factory key, the Tavily key and the user's tool token.
- **Least privilege:** no terminal, no file tools, no code execution, no browser — only our tools, web search, memory and skills.
- **GitOps:** code on the laptop → push → CI tests → images to GHCR → Argo CD syncs both namespaces from `main`. Only CI changes an image tag, so untested code never reaches the cluster.
- **Linux only:** nothing agent-related runs on a laptop. Claude runs the VPS setup and the spike over SSH with its own revocable key.
- **Supabase stays** the source of truth (database, auth, Edge Functions); real users keep today's coach.

## Where we are (2026-09-27)

**Done:** feature flags, seeded demo accounts, the instant-sign-in allowlist moved into a secret, CI with tests, locale checks, `deno check` and gitleaks, LICENSE (MIT, "The Notch authors").

**This week, from the §0 checklist:**
- **Both:** redeem credits and promo codes, create Token Factory keys, note credit expiry dates, register on Devpost.
- **@Maximal1337:** Tavily key, create the VPS, give Claude its SSH login, ask the organizers for extra AI Cloud credits.
- **@dorhaimbob-web:** roll out NH-06. Urgent: the repo stays public, and the old instant-sign-in addresses in its history keep working until it's done.

**Critical path:** VPS → raw Nemotron tool-calling test → OpenShell + Hermes on k3s → per-user sandboxes → isolation and load tests → **go/no-go on Oct 4**. That holds only if keys arrive by Sep 29.

## Scope and capacity

The plan is **179 points; 156 remain ≈ 55 person-days** on the plan's scale. At 20–30 hours a week each, we have roughly 20–30 person-days.

The scale assumes hand-written code; Claude writes most of the code, scripts and manifests, so the real limit is our time for accounts, reviews, phone testing, TestFlight and the video. **We committed to the full plan without cuts and accept the risk.** The minimum line in §9 (167 points) shows what the submission can't do without.

**Owners:**
- **@Maximal1337:** VPS and spike, platform and CI/CD, relay and sandboxes, memory.
- **@dorhaimbob-web:** Supabase rollouts, tools, the app and TestFlight, the video.
- **Both:** the README.

## Budget — inside the credits, nothing out of pocket

| AI Cloud | Period | VPS | Cost |
|---|---|---|---|
| @Maximal1337 ($100) | Sep 29 → Nov 14 | 2 vCPU / 8 GiB, 4/16 on Oct 12–29 only if needed | ≈ $63, ≈ $84 with the upsize |
| @dorhaimbob-web ($100) | Nov 15 → Dec 15 | 2 vCPU / 8 GiB, 4/16 for judging | ≈ $59 |

- **VPS move on Nov 15:** a bootstrap script plus a volume restore. It needs no IP or DNS change, because the VPS only pulls.
- **Token Factory:** hard ceilings of $1.5 a day for the agent and $0.5 per nightly run cap it at ≈ $117 and ≈ $39 of $150 each; the expected total is $50–90.
- **Spend check:** every Monday. If the forecast passes 90%, dev goes off first.

## Dates

| When | What |
|---|---|
| Sep 28–29 | Credits, keys, VPS, NH-06 rollout |
| Oct 4 | Go/no-go on the runtime |
| Oct 5–11 | GitOps, gateways, egress rules, budget controls; tools and relay start |
| Oct 16 | TestFlight build submitted for review |
| Oct 26 | Submit (hard deadline Oct 30, 10:00 PT) |
| Nov 15 | VPS moves to @dorhaimbob-web's credits |
| Dec 1–15 | Judging: prod upsized, prod syncs frozen, spend watched |

## Top risks

- **Alpha software.** OpenShell and Hermes are young, and their Kubernetes path is less traveled than NemoClaw's installer. It's the first thing we test after the VPS is up.
- **Nemotron and tool calls.** Reasoning models can return empty content or break tool calls. We test the raw API before any wiring and run interactive turns with thinking off.
- **Memory on 2 vCPU / 8 GiB.** Hermes has a known memory-growth issue. Idle sandboxes stop after 10 minutes, a watchdog restarts runaway ones, and a temporary upsize fits in the credits. Merging users into a shared space is never the fix.
- **Scope versus capacity** — accepted.
