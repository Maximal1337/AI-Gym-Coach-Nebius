# Submission kit — TestFlight (NH-72), Devpost (NH-93), the video (NH-91), judging (NH-95)

The TestFlight runbook, drafts to paste into Devpost, the video script, and
the checklist for keeping the demo alive through judging. Plan: [`nebius-hackathon-plan.md`](./nebius-hackathon-plan.md), §2 for the rules.

- **Nothing secret goes in this file** — the repository is public. Judge
  addresses go only into Devpost's testing instructions.
- **⟨…⟩ marks what's filled in before submitting:** links (NH-72, NH-91),
  numbers measured on the VPS (NH-25, NH-27), and what the spike and the
  deployment actually taught us. Replace every one, or cut the sentence.
- **Dates:** submit on **2026-10-26**; the hard deadline is 2026-10-30, 10:00 PT.

## The TestFlight build (NH-72)

Submitted to Beta App Review by **2026-10-16** (review usually takes a day;
leave two). EAS build and submit need the team's go-ahead first
(`apps/mobile/AGENTS.md`).

**Before building**

- [ ] **The version.** `app.json` says `1.0.2`, bumped on 2026-08-20 for the
      App Store release. If 1.0.2 is live in App Store Connect, set
      `"version": "1.0.3"`: App Store Connect refuses new builds on a version
      that's already been approved. The build number increments by itself
      (`eas.json`: `autoIncrement`, remote version source).
- [ ] **Leave the version gate alone.** Don't change `public.app_config` for
      this build (`app-version-gate` skill): `latest_version` set to a
      TestFlight-only version would show every App Store user an update they
      can't get.
- [ ] **Checks** from the `verify` skill: typecheck, the full non-lazy Metro
      bundle, `node scripts/check-locales.mjs`.
- [ ] It's the production app against the production Supabase project, like
      the App Store build. Only flagged accounts see the assistant, so anyone
      else who installs from the public link sees today's Notch.

**Build and upload** — from `apps/mobile`, the commands that already worked:

```bash
eas build --platform ios --profile production --non-interactive --no-wait
eas submit --platform ios --id <build id> --non-interactive
```

**In App Store Connect → TestFlight**

- [ ] An external group, "Hackathon judges", with this build.
- [ ] Test information: the beta description and "What to Test" below, a
      feedback email, and the App Review account (NH-06) for Beta App Review.
      Decide first whether that account gets the assistant flags: with them,
      the review covers what the build is for; without them, the reviewer sees
      only today's app.
- [ ] Submit for Beta App Review; once approved, turn on the **public link**
      and put it in the README and Devpost.
- [ ] **Never** "Submit for Review" on the App Store tab: the App Store version
      real users have stays as it is (D-16).
- [ ] Builds expire 90 days after upload: one uploaded on 2026-10-16 lasts to
      2027-01-14, past judging.

**Beta app description**

> Notch is a strength coach: it runs your workout set by set, logs every rep
> and plans progressive overload. This build adds the Coach assistant, built
> for the Nebius × NVIDIA Global AI Hackathon: a personal coach you can talk
> to between workouts, which remembers what matters about you, can change
> your training plan when you ask (and undo it), looks things up on the web
> with sources, and checks in each morning. It is available on the hackathon's
> demo and judge accounts.

**What to Test**

> Sign in with the address from the hackathon's testing instructions, then
> open the Assistant tab. Ask what the coach knows about you; ask it to change
> an exercise's sets or reps, then to undo it; ask a nutrition question and tap
> a source; open "What the coach remembers" and delete a fact. Allow
> notifications to receive the morning check-in.

## The Devpost form

| Field | What goes in |
|---|---|
| Project name | Notch |
| Elevator pitch | [Below](#elevator-pitch) |
| About the project | [Below](#about-the-project) |
| Built with | [Below](#built-with) |
| "Try it out" links | The public TestFlight link ⟨NH-72⟩ and `https://github.com/Maximal1337/AI-Gym-Coach-Nebius` |
| Video | The YouTube link ⟨NH-91⟩ — public, under 3 minutes |
| Track | **Personal AI** |
| City | **Tel Aviv** (City Winner) |
| Changes to a pre-existing project | [Below](#what-changed-after-2026-08-26) |
| Testing instructions | [Below](#testing-instructions) — with the judge addresses filled in. **First confirm the field is visible to judges and organizers only**; if it isn't, give the organizers the addresses privately and write "sent to the organizers" instead |
| Feedback on Token Factory, AI Cloud and NVIDIA tools | [Below](#feedback) |

Before pressing submit: the README's status note replaced by what's live, its
links filled in, the license visible in GitHub's **About** panel (NH-92).

## Elevator pitch

> A strength coach that remembers you, changes your plan when asked and checks in each morning — every user's own Hermes agent in an NVIDIA OpenShell sandbox, on Nemotron via Token Factory.

(187 characters; Devpost allows 200.)

## About the project

### Inspiration

Notch has been on the App Store as a set-by-set workout coach: it runs a
lifter through the session, logs every rep and plans the next weight. But a
lot of coaching happens between workouts — a sore knee, a short Thursday, a
question about food — and a chat that forgets you by tomorrow and can't touch
your plan isn't a coach. We wanted one that knows you, does the small things
for you, and keeps what it knows about you yours.

### What it does

The **Coach assistant** is a new tab in the Notch app:

- **It remembers you.** Every night, Nemotron distils short, typed facts from
  your chats and workouts — injuries, goals, schedule, equipment,
  preferences. *What the coach remembers* shows all of them, and deleting one
  means the coach stops using it.
- **It acts for you.** It saves notes for your next workout and changes an
  exercise's sets, rep range, rest, intensity or warm-up — never the movement
  itself. Every change is stated exactly, recorded, and undoable for 24 hours.
- **It looks things up.** Web search through Tavily, with sources you can tap;
  the coach's rules keep personal details out of the queries.
- **It checks in on its own.** A morning message about today's workout and one
  thing it remembers — or nothing, when there's nothing useful to say.
- **It's private by construction.** Every user has their own agent in their own
  sandbox; its memory, skills and sessions belong to that user alone. The agent
  never holds an API key and reaches training data only through tools that
  check every read and write.

### How we built it

- **An agent per user.** Each user gets their own **Hermes Agent** in their own
  **NVIDIA OpenShell** sandbox, created on their first message, stopped after
  10 idle minutes and deleted with their account. When the sandboxes that fit
  on our VM are all busy, a message waits its turn — users never share one.
- **Nemotron on Nebius Token Factory** for both model calls. **Nemotron Super**
  answers every message and check-in, driving Hermes' tool calls with thinking
  off — a person is waiting, and a reasoning model can spend its whole budget
  thinking and answer with nothing. **Nemotron Ultra** runs the nightly memory
  job with thinking on and a JSON schema; every operation it proposes is
  validated, and the facts' scores are computed in code. Daily spend ceilings
  in our code bound what either can cost.
- **Keys the agent never sees.** OpenShell's proxy adds the Token Factory key,
  the Tavily key and the user's own tool token to outgoing requests — each only
  for its own host.
- **Tools that act safely.** `notch-tools` is our MCP server over the user's
  real training data: four read tools and three write tools, with an audit
  trail and undo. A tool never takes a user id from the model; the per-user
  token decides whose data it is.
- **Memory users can trust.** Up to 15 facts per user, scored and evicted by
  rules in code, injected into every request as data rather than
  instructions. Hermes' own user-profile store is off, so a deleted fact can't
  live on inside the agent.
- **A channel with no inbound ports.** The app writes to Supabase; a relay on
  the Nebius VM pulls jobs over signed requests, runs them in the user's
  sandbox and posts the reply back, with a push notification.
- **One Nebius VM, run by GitOps.** k3s with Argo CD, which syncs the cluster
  from Git; CI builds the images after green tests. The whole deployment fits
  inside our hackathon credits.
- **Ours versus upstream.** OpenShell, Hermes Agent and NemoClaw's Hermes
  blueprint are the runtime, pulled at pinned versions under their own
  licenses. The relay, the sandbox manager, the tools, the memory pipeline, the
  coach's rules, the deployment and the app are ours.

### Challenges we ran into

- **Isolation on a small VM.** A sandbox per user is the right privacy model
  but costs memory. We start sandboxes on demand, stop idle ones, cap how many
  run at once and queue the rest in order — capacity runs out as waiting, never
  as sharing.
- **Reasoning models and tool calls.** A reasoning model can spend its token
  budget thinking and return empty content, which a tool loop reads as
  "nothing to say". We turned thinking off where tools are called, test for
  that failure before any wiring, and make our client fail loudly on it.
- **Memory the user controls.** Deleting a fact has to really delete it. That
  ruled out letting the agent keep its own profile of the user, and made our
  facts — visible and deletable — the only memory about the person.
- **Secrets in a public repository.** Keys live in the gateway, not in the
  agent or in Git; an old sign-in allowlist in the history was moved into a
  secret and its addresses retired ⟨once NH-06 is rolled out⟩.
- ⟨What the spike and the deployment actually hit — NH-21 to NH-27.⟩

### Accomplishments that we're proud of

- Real per-user isolation that holds under load: waiting, never sharing.
- An assistant that changes things but can always be undone.
- A memory users can read and edit, with the rules for what's kept written in
  code, not left to the model.
- Spend that can't run away, by construction.
- ⟨Numbers from the live system: reply latency, cold start, cost per ten-turn
  conversation (NH-25).⟩

### What we learned

- ⟨From the spike: how OpenShell behaves on Kubernetes, and Nemotron's tool
  calling with thinking off (NH-28, NH-22).⟩
- Keeping the model out of anything that must be exact — progression numbers,
  fact scores, which user a tool acts for — made the agent far easier to trust.

### What's next

Releasing the assistant to every Notch user, which needs a capacity plan for
sandboxes at scale and privacy disclosures; replies in Hebrew, Arabic and
Portuguese held to the same quality bar; and bringing the agent into the
workout itself, so it can log sets and adjust the session live.

### Built with

nvidia-nemotron · nebius-token-factory · nebius-ai-cloud · nvidia-openshell ·
hermes-agent · ⟨nvidia-nemoclaw, if the image is built from its blueprint
(NH-21)⟩ · tavily · model-context-protocol · supabase · postgresql · deno ·
typescript · node.js · react-native · expo · kubernetes · k3s · argo-cd ·
github-actions

## What changed after 2026-08-26

> Notch's app was built between 2026-07-26 and 2026-08-20 and has been on the
> App Store since. Everything in this submission is new since 2026-08-26 and
> additive — the existing app and its in-workout coach work as before:
>
> - The Coach assistant end to end: the chat channel and job queue, the relay,
>   per-user OpenShell sandboxes with Hermes and their lifecycle, and the
>   Assistant tab.
> - Tools that act: the `notch-tools` MCP server, write tools limited to one
>   exercise's parameters, an audit trail and 24-hour undo.
> - Memory across sessions: typed facts, scoring and eviction in code, the
>   nightly extraction on Nemotron, an evaluation set, and the screen where
>   users see and delete what the coach remembers.
> - The proactive daily check-in.
> - Nemotron on Nebius Token Factory for every assistant reply and for memory,
>   with hard daily spend ceilings; Tavily search with sources.
> - The deployment: a k3s cluster on a Nebius VM managed by Argo CD, images
>   built by CI, isolation between environments, backups and monitoring.
>
> Details and the full list: the README's "What changed during the submission
> period" section.

## Testing instructions

Paste with the addresses filled in, one per judge (`private.demo_accounts`),
and only after the check in the form table above.

> **Get the app.** On an iPhone, open ⟨TestFlight public link⟩, install
> TestFlight if asked, then install Notch.
>
> **Sign in.** Choose email sign-in and enter your address — you're in at once,
> no code or password:
>
> - Judge 1: ⟨judge address⟩
> - Judge 2: ⟨judge address⟩
> - … one per judge
>
> Each judge has their own account with two weeks of training history, and
> each account has its own agent, isolated from the others like any real
> user's. Allow notifications to see the morning check-in.
>
> **Try the Assistant tab:**
>
> 1. *"What do you know about me?"* — it answers from the facts it keeps. The
>    button in the chat's header opens *What the coach remembers*.
> 2. *"Make my bench press 4 sets of 6 this week."* — it changes the plan and
>    says exactly what changed; the Workout tab shows it. Then *"undo that"*.
> 3. *"Which vegetarian foods have 30 g of protein per serving?"* — a web
>    answer with sources you can tap.
> 4. Delete a fact on the memory screen, then ask about it: the coach no longer
>    uses it.
> 5. A check-in arrives around 06:00 UTC as a notification, when there's
>    something worth saying.
>
> **Good to know.** A reply usually takes ⟨p50⟩ seconds; if your agent was
> asleep, the first one takes up to ⟨cold start⟩ seconds while it starts, and
> when many judges write at once a message may show "waiting" before its turn.
> New facts from today's chat appear after the nightly run (00:00–03:00 UTC).
> Each account can send up to 100 messages a day. The Workout tab is Notch's
> existing in-workout coach; the hackathon work is the Assistant tab.
>
> Questions: ⟨team contact⟩.

## Feedback

Written from what we actually hit. Everything marked ⟨…⟩ waits for the live
runs; cut what turns out not to be true.

**Nebius Token Factory**

- The OpenAI-compatible API made the integration a base-URL change: Hermes'
  provider, our Edge Function client and the smoke test all speak it as-is.
- ⟨Nemotron tool calling with `reasoning_effort: "none"`, and JSON-schema
  output — from NH-28's report.⟩
- ⟨Latency and reliability over the demo period (NH-25, NH-95).⟩
- We built daily spend ceilings into our own code. A hard spend cap per API
  key, enforced by Token Factory, would make that unnecessary for teams on
  credits ⟨unless it exists and we missed it — then: more visible docs⟩.

**Nebius AI Cloud**

- ⟨Provisioning the VM, and the move between two accounts on 2026-11-15
  (NH-30, NH-96).⟩
- The rules count Serverless Jobs, Endpoints and DevPods as AI Cloud use, but
  not a plain VM — worth saying on the credits page, since agent sandboxes need
  a long-running cluster.
- The public IPv4 price wasn't on the pricing page, and the budgets docs don't
  say whether usage covered by credits counts toward a budget; both matter
  when the rule is "no spend beyond the credits".

**NVIDIA OpenShell**

- Credential placeholders resolved by the proxy, per endpoint, are exactly what
  a multi-user assistant needs: the agent never holds a key it could leak.
- On Kubernetes, user API authentication is OIDC or a trusted proxy only;
  a lighter option for a single-node deployment would help.
- The Helm chart generates its credential key with `lookup`, which doesn't work
  under GitOps tools that render without cluster access (Argo CD), so we
  create the key before the chart.
- ⟨What the spike found: sandbox provisioning, cold start, isolation tests
  (NH-21, NH-25, NH-26).⟩

**Hermes Agent**

- `SOUL.md` and `config.yaml` made the coach's rules and its tool allowlist
  declarative, and easy to pin with tests.
- Background model calls (post-turn reviews, session titles) are on by
  default; for a deployment that has to count every token, off-by-default or a
  single switch would be friendlier.
- ⟨Behaviour in a long-running sandbox: memory growth, restarts (NH-25).⟩

**NVIDIA NemoClaw and Nemotron**

- ⟨NemoClaw's Hermes blueprint as the base image (NH-21).⟩
- ⟨Nemotron's replies in the user's language, tool-call accuracy, cost per
  conversation (NH-25).⟩

## The demo video (NH-91)

**Rules** (§2): public on YouTube, **under 3 minutes**, the voiceover explains
how **Token Factory and Nemotron** are used, and no third-party music or
trademarks. From the plan: show memory across sessions, the assistant acting
(a tool-driven change and a check-in), a Tavily answer with sources and
per-user isolation, and say what's ours versus upstream.

**Recording:** iPhone screen recording on the **team demo account** — never a
judge account, and no judge address on screen. Capture the morning check-in
the day before. A terminal shot is from the VPS with nothing secret visible (no
env files, no Secrets, no tokens in URLs). Either no music, or music we made.
Name NVIDIA, Nebius, OpenShell, Hermes and Tavily in speech and captions; no
other companies' logos.

About 275 words of voiceover — two minutes of speech at a calm pace, which
leaves time on screen for the replies to arrive. Cut the waits in editing, not
the lines about Token Factory and Nemotron:

| Time | Shot | Voiceover |
|---|---|---|
| 0:00–0:15 | Notch's workout screen, then the Assistant tab | Notch is a strength coach on the App Store. For this hackathon we gave every lifter their own always-on coach — one that remembers them, acts for them, and keeps what it knows about them private. |
| 0:15–0:45 | *What the coach remembers*: the knee, the schedule. Then ask: "I've only got 40 minutes on Thursday — what should I cut?" The reply works around the knee | It remembers you across sessions. Every night, NVIDIA Nemotron Ultra on Nebius Token Factory reads the day's chats and workouts and distils short facts. The scoring is in code, not in the model, and every fact is yours to see — and to delete. |
| 0:45–1:15 | "Make my bench press 4 sets of 6 this week." The reply states the change; the Workout tab shows it. "Undo that." | It acts for you. Nemotron Super drives the agent's tool calls, with thinking off so answers come fast. It can change an exercise's sets, reps, rest or intensity — never the movement — it says exactly what it changed, and anything can be undone for a day. |
| 1:15–1:35 | "Which vegetarian foods have 30 grams of protein?" Tap a source | It looks things up with Tavily and shows where each answer came from — and its rules keep anything personal out of the search. |
| 1:35–1:55 | The morning notification on the lock screen, opened | And it doesn't wait to be asked: each morning it checks in about today's workout — or stays quiet when there's nothing useful to say. |
| 1:55–2:30 | The architecture diagram; then the VPS terminal listing one sandbox per user | Under the hood, every user has their own Hermes Agent, in their own NVIDIA OpenShell sandbox, on a Nebius VM. The agent never sees an API key: OpenShell adds the Token Factory key only on requests to Token Factory. When the machine is full, people wait their turn — no one ever shares a sandbox. |
| 2:30–2:50 | The repository README, "What we built, and what we build on" | OpenShell, Hermes Agent and NemoClaw are the runtime. The relay, the sandbox manager, the tools, the memory pipeline and the app are ours — and every Token Factory call has a daily spending ceiling. |
| 2:50–2:58 | The Assistant tab | Notch: a coach that knows you, and works for you. |

After recording: check the length (under 3:00 with the title card), captions
on, visibility **public**, and the link in Devpost and the README.

## Keeping the demo alive through judging (NH-95)

Every week from 2026-10-30 to 2026-12-15, one owner per week ⟨names⟩:

- [ ] The health check is green in healthchecks.io, and the latest backup is
      less than a day old (`deploy/README.md`, Monitoring).
- [ ] A judge-style run on the team demo account: sign in, one message with a
      reply, the memory screen opens.
- [ ] The TestFlight build is still valid: builds expire 90 days after upload,
      so a build uploaded by 2026-10-16 lasts past 2026-12-15 — a newer upload
      restarts the clock.
- [ ] Credits and spend: the Monday check in [`budget-runbook.md`](./budget-runbook.md), both accounts.
- [ ] Judge accounts untouched: **never re-seed during judging** — it wipes
      what a judge did. The last re-seed is on submission day, after the final
      demo run.

Fixed dates:

- **2026-10-26:** re-seed every demo and judge account
  (`dev-test-scenario-accounts` skill), let the nightly job build their facts,
  then submit.
- **2026-11-15:** the move to member B's credits (NH-96), a week-long check
  after it.
- **2026-12-01:** resize to 4 vCPU / 16 GiB; confirm the prod sync windows are
  active (`argocd --core proj windows list notch` and `… platform`).
- **Incident contact:** ⟨who answers the health check's emails, per week⟩.
