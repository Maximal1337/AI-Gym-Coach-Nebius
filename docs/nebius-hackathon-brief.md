# Notch × Nebius Hackathon — one-page brief

For the kickoff conversation between the two of us. Full detail: [`nebius-hackathon-plan.md`](./nebius-hackathon-plan.md) (decisions in §4, issues in §10).

**Dates:** submission 2026-10-30 10:00 PT · judging 2026-12-01 → 12-15, the demo must stay up that whole time · track: Personal AI · city: Tel Aviv.

## What we're submitting

Notch gets a personal coach that **remembers between sessions and acts on your behalf** — which is exactly what the track is judged on:

- A NanoClaw agent per user on a Nebius VM, answering in the app outside workouts.
- Our own MCP tool server over the real training data: it reads the plan and history, saves notes, swaps an exercise — every write validated server-side, logged, and undoable.
- Memory: a nightly job turns chats into typed facts, scored in code, capped at 15, injected into every reply.
- Tavily for grounded answers (nutrition labels, exercise substitutions) — worth a $3,000 bonus.
- A proactive daily check-in, so it isn't only reactive.

Only two things are mandatory: a runtime call to **Nebius Token Factory** and at least one **NVIDIA Nemotron** model. NanoClaw and Tavily are optional — we use them because they earn their place, not to tick boxes.

**Judging stage 1 rejects "deployed an open-source project and renamed it".** So the README and the video lead with our tools, memory and per-user isolation; NanoClaw is described as the runtime.

## Where we are (2026-09-23)

**Done, committed, nothing deployed:** feature flags end to end, seeded demo accounts with two weeks of realistic history, instant-sign-in addresses moved out of the repo into a secret, CI running tests, locale checks and `deno check`, gitleaks over the full history. All 29 migrations and the seed verified against a real Postgres.

**Blocked on us:** Nebius credits and keys, Devpost registration, Tavily key, the NH-06 rollout to Supabase, and the repository being public.

**Critical path:** credits → raw Token Factory tool-calling test → provider path → **go/no-go by 2026-09-30**. If Nemotron can't do tool calls the way we need, the agent design changes, so nothing past that point is worth starting first.

## Decide together

1. **Hours per week each of us can give.** The full plan is ~55 person-days across five weeks — that's close to two people full time. If it's evenings, we commit to the minimum line below instead. Everything else depends on this answer.
2. **The repository has been public since 2026-09-16.** Its history holds your phone number and personal email, and the old instant-sign-in addresses still work in production until we deploy NH-06. Proposal: make it private today, roll out NH-06, move `app-store-connect-form.md` into the git-ignored `secrets/`, and publish a fresh repo from filtered history at submission.
3. **Six decisions I made that touch production** — confirm or overrule: JSONB in Supabase instead of MongoDB · one agent group per user · the VM pulls work and accepts no inbound traffic · 2 vCPU / 8 GiB from Oct 1 to Dec 15 · judges test via TestFlight and seeded demo accounts · existing coaching functions stay frozen during the hackathon.
4. **Who is "member A"** — the VM and the agent key live on their Nebius account; the nightly memory job runs on the other's key, which doubles the usable credits.
5. **Who owns which milestone.**
6. **License:** MIT, and whose name goes in `LICENSE`.
7. **Access:** Supabase secrets and deploys, App Store Connect, `eas build` — all yours; the repo requires a human to approve builds.

## Two scope options

| | Full plan | Minimum viable |
|---|---|---|
| Scope | 156 points, ~55 person-days | ~110 points |
| Extra it buys | In-workout coaching on NanoClaw, memory eval, backups, monitoring, the "what the coach remembers" screen | — |
| Cut | — | Stage B, memory eval, extra monitoring, `deno check` in CI; memory shown inside the chat instead of its own screen |
| Both keep | Spike, VM, tools, memory, proactive check-in, TestFlight build, submission package | |

Either way the submission package is never where we save time: public repo with the license visible, README explaining how Nemotron and Token Factory are used and what is ours versus upstream, a video under 3 minutes with a voiceover about Token Factory and Nemotron, TestFlight link plus demo logins, feedback form, city Tel Aviv.

## Dates

| When | What |
|---|---|
| This week | Credits and keys, NH-06 rollout, repo decision, the seven answers above |
| Sep 30 | Go/no-go on the agent runtime |
| Oct 1–7 | VM up, coach template and tools |
| Oct 8–14 | Channel, memory, TestFlight build submitted by Oct 12 |
| Oct 26 | Submit (hard deadline Oct 30, 10:00 PT) |
| Dec 1–15 | Judging: deploys frozen, VM and build kept alive, spend watched |

## Top risks

- **Nemotron and tool calls.** Known reports of reasoning models returning empty content and failing tool calls. We test the raw API before touching NanoClaw, and run interactive turns with thinking off.
- **NanoClaw and custom endpoints.** Upstream issue #1984 is open: pointing its providers at an OpenAI-compatible endpoint needs a patched provider. Fallbacks, in order: a LiteLLM proxy on the documented `ANTHROPIC_BASE_URL` path, patching our fork, or dropping NanoClaw from the realtime path and keeping our own agent loop.
- **Scope versus capacity.** The honest fix is picking the right scope line now, not discovering it in the last week of October.

Budget is not a risk: roughly $150 Token Factory and $100 AI Cloud per member covers the VM through judging with headroom.
