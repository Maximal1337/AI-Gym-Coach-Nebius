# Submission kit — TestFlight (NH-72), Devpost (NH-93), the video (NH-91), judging (NH-95)

The TestFlight runbook, drafts to paste into Devpost, the video script, and
the checklist for keeping the demo alive through judging. Plan: [`nebius-hackathon-plan.md`](./nebius-hackathon-plan.md), §2 for the rules.

- **Nothing secret goes in this file** — the repository is public. Demo and
  judge addresses go only into App Review Information and Devpost's private
  testing instructions.
- **⟨…⟩ marks the links filled in before submitting:** the public
  TestFlight link, the video and the repository. Everything else is final.
- **Dates:** submit on **2026-10-26**; the hard deadline is 2026-10-30, 10:00 PT.

## What the rules require (checked 2026-10-21)

- [x] **A license in the repository** — `LICENSE`, MIT; GitHub shows it in
      the About panel.
- [x] **A README with instructions to run it** — the root `README.md`,
      "Setup": requirements, the workspace, Supabase (every function, and
      what each needs), the app, the in-workout coach service and the
      cluster.
- [x] **A written explanation of the significant changes**, since Notch
      existed before the hackathon — the README's "What changed during the
      submission period (after 2026-08-26)", and the Devpost field drafted
      below ("What changed after 2026-08-26").
- [x] **Feedback on Nebius and NVIDIA's tools** — below ("Feedback"); it
      goes into Devpost's feedback field (NH-93).
- [ ] **A video under 3 minutes, public on YouTube** — the script and shot
      list below; recording on 2026-10-24 (NH-91).
- [ ] **The repository in the entry is the code that runs.** Prod deploys
      from this repository (D-38). If the entry links the mirror repository
      instead, it is fast-forwarded to this repository's `main` right before
      submitting, and checked: the same commit at the head of both.

## The TestFlight build (NH-72)

Submitted to Beta App Review on **2026-10-20**; approved on **2026-10-23**,
and the public link is on. EAS build and submit need the team's go-ahead
first (`apps/mobile/AGENTS.md`).

**Before building**

- [x] **A separate app** (D-16, 2026-10-19): "Notch Coach",
      `com.dorbob.gymcoach.nebius`, its own EAS project and App Store Connect
      record, never released to the App Store, on the **test** Supabase
      project until judging ends. Its version line starts at `1.0.0`; the
      build number increments by itself (`eas.json`: `autoIncrement`, remote
      version source).
- [x] **The version gate on the test project**: `latest_version` is `1.0.0`
      there (set on 2026-10-19), so the build isn't nudged to the App Store.
      The live app's project is untouched.
- [ ] **Checks** from the `verify` skill: typecheck, the full non-lazy Metro
      bundle, `node scripts/check-locales.mjs`.
- [ ] **Who meets the coach**: only the demo accounts — addresses allowlisted
      for instant sign-in on the test project, seeded, with the assistant
      flags (`dev-test-scenario-accounts` skill). Anyone else who installs
      from the public link gets the app without the coach, so strangers never
      spend prod's daily ceiling or its sandboxes. Sign in with Apple works
      (the test project's Apple provider has the bundle id) but gives such an
      account; email codes reach only the team (Supabase's built-in email).
      The demo addresses go only into App Review Information and Devpost's
      private testing instructions, never into the README or this file.

**Build and upload** — from `apps/mobile`, the commands that already worked:

```bash
eas build --platform ios --profile production --non-interactive --no-wait
eas submit --platform ios --id <build id> --non-interactive
```

**In App Store Connect → TestFlight**

- [x] An external group, "Hackathon judges", with this build.
- [x] Test information: the beta description and "What to Test" below, a
      feedback email, and the App Review account for Beta App Review — a demo
      account with the assistant flags (decided 2026-10-19), in prod's
      `SANDBOX_KEEP_RUNNING` while the review lasts. In App Review
      Information: sign-in required; user name, the review account's demo
      email; password: none; notes: "Sign in with the demo email: choose
      email sign-in and enter the address — you're signed in at once, with no
      code or password. The Coach is available on demo accounts only."
- [x] Submit for Beta App Review; once approved, turn on the **public link**
      and put it in the README and Devpost — approved 2026-10-23, link on;
      it goes into both at submission.
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
> with sources, and checks in every day. It is available on the hackathon's
> demo and judge accounts.

**What to Test**

> Sign in with the demo email from the hackathon's testing instructions, then
> open the Assistant tab. Ask what the coach knows about you; ask it to change
> an exercise's sets or reps, then to undo it; ask a nutrition question and tap
> a source; open "What the coach remembers" and delete a fact. Allow
> notifications to receive the daily check-in.

## The Devpost form

| Field | What goes in |
|---|---|
| Project name | Notch |
| Elevator pitch | [Below](#elevator-pitch) |
| About the project | [Below](#about-the-project) |
| Built with | [Below](#built-with) |
| "Try it out" links | ⟨public TestFlight link⟩ and ⟨repository link⟩ |
| Video | ⟨YouTube link⟩ — public, under 3 minutes |
| Track | **Personal AI** |
| City | **Tel Aviv** (City Winner) |
| Changes to a pre-existing project | [Below](#what-changed-after-2026-08-26) |
| Testing instructions | [Below](#testing-instructions) — with the judge addresses filled in. **First confirm the field is visible to judges and organizers only**; if it isn't, give the organizers the addresses privately and write "sent to the organizers" instead |
| Feedback on Token Factory, AI Cloud and NVIDIA tools | [Below](#feedback) |

Before pressing submit: the README's two links filled in, its status note
still true, the license visible in GitHub's **About** panel (NH-92), and —
if the entry links the mirror repository — the mirror fast-forwarded to this
repository's `main`, the same commit at the head of both.

## Elevator pitch

> A strength coach that remembers you, changes your plan when asked and checks in every day — every user's own Hermes agent in an NVIDIA OpenShell sandbox, on Nemotron via Token Factory.

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
- **It checks in on its own.** A daily message (06:00 UTC) about today's
  workout and one thing it remembers — or nothing, when there's nothing useful to say.
- **Its workout coach runs on Nemotron too.** In this build, My Coach — the
  plan it writes for you and the coach inside each workout — runs on
  Nemotron Super through Token Factory, in the user's language.
- **It's private by construction.** Every user has their own agent in their own
  sandbox; its memory, skills and sessions belong to that user alone. The agent
  never holds an API key and reaches training data only through tools that
  check every read and write — and it's hardened against web pages that try
  to speak for the user.

### How we built it

- **An agent per user.** Each user gets their own **Hermes Agent** in their own
  **NVIDIA OpenShell** sandbox, created on their first message, stopped after
  10 idle minutes and deleted with their account. When the sandboxes that fit
  on our VM are all busy, a message waits its turn — users never share one.
- **Nemotron on Nebius Token Factory** for every model call. **Nemotron Super**
  answers every message and check-in and drives Hermes' tool calls with a
  little thinking (`reasoning_effort: "low"`): with none, it promised actions
  it never took; with more, a reasoning model can spend its whole budget
  thinking and answer with nothing. **Nemotron Ultra** runs the nightly memory
  job with thinking on and a JSON schema; every operation it proposes is
  validated, and the facts' scores are computed in code. My Coach's plans
  and in-workout coach run on Super as well: the existing LangGraph coach now
  runs inside our Edge Functions with its model client pointed at Token
  Factory. Daily spend ceilings in our code bound what each can cost.
- **Keys the agent never sees.** OpenShell's proxy adds the Token Factory key,
  the Tavily key and the user's own tool token to outgoing requests — each only
  for its own host. The sandbox's network policy lets Hermes reach exactly
  three places: Token Factory, Tavily's search and our tools.
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
  sandbox image are the runtime, pulled at pinned versions under their own
  licenses. The relay, the sandbox manager, the tools, the memory pipeline, the
  coach's rules, the deployment and the app are ours.

### Challenges we ran into

- **Isolation on a small VM.** A sandbox per user is the right privacy model
  but costs memory. We start sandboxes on demand, stop idle ones, cap how many
  run at once and queue the rest in order — capacity runs out as waiting, never
  as sharing.
- **Reasoning models and tool calls.** A reasoning model can spend its token
  budget thinking and return empty content, which a tool loop reads as
  "nothing to say", so we first turned thinking off. That had its own
  failure: once a conversation had history, the agent called the tool a turn
  needed in only 6 of 16 — it said "I'll pull that up now" and stopped, or
  answered "I've reverted your bench press" without undoing anything. A
  little thinking (`low`) fixed it: 16 of 16, and 40 of 40 across the whole
  tool check, for about the same cost. Our client fails loudly on an empty
  reply either way.
- **Memory the user controls.** Deleting a fact has to really delete it. That
  ruled out letting the agent keep its own profile of the user, and made our
  facts — visible and deletable — the only memory about the person.
- **Secrets in a public repository.** Keys live in the gateway, not in the
  agent or in Git, and the instant sign-in allowlist lives in a secret, with
  random addresses.
- **A model that fills the schema its own way.** On the memory job's first
  real run, Nemotron Ultra put each new fact's wording in the field meant
  for a reference to an existing fact and left the category out, so our
  validator dropped all 24 operations and stored nothing — safe, but empty.
  The prompt now spells out every operation's fields, and the parser takes a
  wording from the wrong field when it clearly is one; the next run kept 25
  facts and dropped none.
- **OpenShell on Kubernetes, the less traveled path.** Its gateway strips
  `Authorization` on the way to a sandbox, so Hermes needed a patch to take
  its key from another header; a gate NemoClaw adds to Hermes waits forever
  on a Kubernetes volume; about one sandbox start in seven waits 2 min 16 s
  more for OpenShell 0.1.2's supervisor; and a gateway restart left running
  sandboxes out of reach for up to 13 s, which used up a message's retries
  until the relay learned to wait instead. Each one found on the real
  cluster, and each with a test now.
- **Any web page could speak as the user.** Hermes tells the model that text
  after an `[OUT-OF-BAND USER MESSAGE]` marker is the user talking mid-turn,
  but never strips that marker from tool results. So a page Tavily returns, a
  file or an MCP response can impersonate the user; in a stock install with
  shell tools, that's a web page giving instructions with the user's
  authority. We found it while auditing the prompt Hermes sends (open
  upstream as [#81828](https://github.com/NousResearch/hermes-agent/issues/81828)), proved it — 10 of 10 turns obeyed a forged
  marker — and closed it with a patch that relabels the marker in every tool
  result: 0 of 10, live in production, and submitted upstream as
  [PR #143928](https://github.com/NousResearch/hermes-agent/pull/143928).

### Accomplishments that we're proud of

- **Closed a prompt-injection hole in Hermes Agent — and sent the fix
  upstream.** Auditing what Hermes adds to the system prompt, we
  independently found that any tool result — a web page, a file, an MCP
  response — can carry the marker Hermes trusts as the user's own voice
  (tracked upstream as [#81828](https://github.com/NousResearch/hermes-agent/issues/81828), still open in every release). On
  our stack, a forged marker in a search result took over the reply in 10 of
  10 turns. Our build-time patch takes it to 0 of 10 in production, and we
  contributed the fix, with 16 tests, as [PR #143928](https://github.com/NousResearch/hermes-agent/pull/143928).
- Real per-user isolation that holds under load: waiting, never sharing — and
  checked from inside a sandbox: no keys, no other user's data, no way out
  but the three hosts the policy names.
- An assistant that changes things but can always be undone.
- A memory users can read and edit, with the rules for what's kept written in
  code, not left to the model.
- Spend that can't run away, by construction.
- Numbers from the live system: 900 turns over a 15-hour soak with none
  failed or empty (p95 7.9 s); a ten-turn conversation at p95 5 to 10 s and
  about $0.05; the tools called in 40 of 40 turns that needed one; six
  sandboxes running on a 2-vCPU, 8 GiB VM with 4 GiB to spare.
- Memory measured, not assumed: on 12 chats with expected facts, recall 1.00
  and precision 0.79 to 0.92 for about 3 cents a run; the nightly job about
  6 s a user.
- A workout coach on Nemotron that keeps up with a lifter: a new plan in
  about 5 s for 0.14 cents, a reply mid-workout in 1 to 2.5 s.

### What we learned

- Measure the agent with history, not just single questions: with thinking
  off and no conversation before it, Nemotron called the tool a turn needed
  in 36 of 37 turns; after an earlier exchange, in 6 of 16. The second number
  decided the setting.
- Read what the framework adds to the prompt. Hermes' own guidance was about
  half of the system prompt, and some of it pulled against our coach — one
  part of it was the open marker issue above.
- On a small VM, a sandbox per user is affordable if sandboxes stop when
  idle: Hermes levels off at about 300 MiB, so six fit in 8 GiB.
- Keeping the model out of anything that must be exact — progression numbers,
  fact scores, which user a tool acts for — made the agent far easier to trust.
- A validator that drops bad output needs a counter next to it. The memory
  job's summary counts dropped operations, and that number — 24 of 24 — is
  what showed the first real run had stored nothing.

### What's next

Releasing the assistant to every Notch user, which needs a capacity plan for
sandboxes at scale and privacy disclosures; continuing each user's Hermes
session instead of resending the history as text, which keeps the real tool
calls in context; replies in Hebrew, Arabic and Portuguese held to the same
quality bar; and bringing the agent into the workout itself, so it can log
sets and adjust the session live.

### Built with

nvidia-nemotron · nebius-token-factory · nebius-ai-cloud · nvidia-openshell ·
hermes-agent · nvidia-nemoclaw · tavily · model-context-protocol · langgraph ·
supabase · postgresql · deno · typescript · node.js · react-native · expo ·
kubernetes · k3s · argo-cd · github-actions

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
> - My Coach on Nemotron in the hackathon build: plan generation and the
>   in-workout coach moved from Gemini to Token Factory.
> - A separate TestFlight app on its own Supabase project, so the App Store
>   app and its users are untouched.
> - The deployment: a k3s cluster on a Nebius VM managed by Argo CD, images
>   built by CI, isolation between environments, backups and monitoring.
>
> Details and the full list: the README's "What changed during the submission
> period" section.

## Testing instructions

Paste with the three judge accounts' addresses filled in (`private.demo_accounts`),
and only after the check in the form table above. Two of them are in prod's
`SANDBOX_KEEP_RUNNING` (with the reviewer's, 3 of prod's 4 running places);
the spare one isn't, and holds the fourth place only while it's in use
(decided 2026-10-23).

> **Get the app.** On an iPhone, open ⟨TestFlight public link⟩, install
> TestFlight if asked, then install Notch Coach.
>
> **Sign in with the demo email.** Choose email sign-in and enter your
> address — you're in at once, no code or password. (Sign in with Apple gives
> a fresh account without the Coach.)
>
> - Judge account 1: ⟨address⟩
> - Judge account 2: ⟨address⟩
> - Spare account: ⟨address⟩
>
> The accounts are shared by the judges and reset before judging starts.
> Each comes with two weeks of training history and has its own agent,
> isolated from the others like any real user's. Allow notifications to get
> the daily check-in; if you allow them later in Settings, close and reopen
> the app once.
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
> 5. Once a day at 06:00 UTC (the night before in the Americas) the coach
>    checks in on its own as a notification, when there's something worth
>    saying. If it comes while you sleep, it's waiting in the chat.
>
> **Good to know.** A reply usually takes 5 to 10 seconds, longer when the
> coach searches the web. The two judge accounts' agents are always running;
> the spare account's starts with its first message. If a reply takes long,
> wait up to a minute, or use another account. When many judges write at once a message may show
> "Waiting for your coach…" before its turn, and after two minutes "Taking
> longer than usual" — the reply still arrives, with a notification.
> New facts from today's chat appear after the nightly run (00:00–03:00 UTC).
> Each account can send up to 100 messages a day. If the coach says it has
> reached today's limit, the demo's shared daily budget is spent: it's back at
> 00:00 UTC. My Coach — plans and the in-workout coach — runs on Nemotron
> too; the hackathon's main work is the Assistant tab.
>
> Questions: ⟨team contact⟩.

## Feedback

Written from what we actually hit.

**Nebius Token Factory**

- The OpenAI-compatible API made the integration a base-URL change: Hermes'
  provider, our Edge Function client, the in-workout coach's LangChain client
  and the smoke test all speak it as-is.
- Steady under load: 900 turns over a 15-hour soak with none failed or empty,
  p50 4.9 s and p95 7.9 s, the same at the end as at the start.
- `reasoning_effort` matters more than its name suggests. With `"none"`,
  Nemotron Super called the tool a turn needed in only 6 of 16 turns that came
  after an earlier exchange; with `"low"`, 16 of 16, for about the same cost.
  A line in the docs on how it affects tool calling would save the next team
  that measurement.
- With `response_format: json_schema` (we didn't set `strict`), Nemotron Ultra
  returned schema-shaped JSON but put a value under the wrong key and left
  required fields out. Whether `strict` is supported, and enforced, deserves a
  sentence in the docs.
- We built daily spend ceilings into our own code. A hard spend cap per API
  key, enforced by Token Factory, would make that unnecessary for teams on
  credits.

**Nebius AI Cloud**

- One 2-vCPU, 8 GiB VM ran the whole deployment — k3s, Argo CD, two OpenShell
  gateways, two relays and up to six agent sandboxes — inside our credits.
- The rules count Serverless Jobs, Endpoints and DevPods as AI Cloud use, but
  not a plain VM — worth saying on the credits page, since agent sandboxes need
  a long-running cluster.
- The public IPv4 price wasn't on the pricing page, and the budgets docs don't
  say whether usage covered by credits counts toward a budget; both matter
  when the rule is "no spend beyond the credits".

**NVIDIA OpenShell**

- Credential placeholders resolved by the proxy, per endpoint, are exactly what
  a multi-user assistant needs: the agent never holds a key it could leak, and
  a placeholder sent to another host got a 403 and went nowhere.
- On Kubernetes, user API authentication is OIDC or a trusted proxy only;
  a lighter option for a single-node deployment would help.
- The Helm chart generates its credential key with `lookup`, which doesn't work
  under GitOps tools that render without cluster access (Argo CD), so we
  create the key before the chart.
- What the real cluster taught us on 0.1.2: about one sandbox start in seven
  waits 2 min 16 s more for the supervisor's first connection; a gateway
  restart leaves running sandboxes out of reach for up to 13 s; and the
  gateway strips `Authorization` on the way into a sandbox, so a server inside
  needs its key in another header.

**Hermes Agent**

- `SOUL.md` and `config.yaml` made the coach's rules and its tool allowlist
  declarative, and easy to pin with tests.
- Stable in a long-running sandbox: memory levelled off at about 300 MiB over
  the 15-hour soak, no leak.
- Background model calls (post-turn reviews, session titles) are on by
  default; for a deployment that has to count every token, off-by-default or a
  single switch would be friendlier.
- Its guidance tells the model to trust an "out-of-band user message" marker
  inside a tool result as the user's own words, so a web page could speak for
  the user — the open issue [#81828](https://github.com/NousResearch/hermes-agent/issues/81828). On our stack a forged marker
  in a search result was obeyed in 10 of 10 turns; our build-time patch takes
  it to 0 of 10, and we've sent the fix upstream as
  [PR #143928](https://github.com/NousResearch/hermes-agent/pull/143928).
- Its built-in Token Factory provider doesn't send `reasoning_effort`, so we
  set it in a provider entry of our own.

**NVIDIA NemoClaw and Nemotron**

- Publishing the built Hermes sandbox image, multi-arch and pinnable by
  digest, meant our image is NemoClaw's plus the coach's profile: nothing of
  theirs to build.
- The `hermes` wrapper's secret boundary is a good default: it refuses to start
  the gateway while a raw secret sits in the environment. It matches variable
  names, so our model id under `TOKEN_FACTORY_MODEL` counted as a secret too,
  and we learned the one place the API server key may live (a 0640 `.env` in
  `HERMES_HOME`) from the validator's source. A section on the boundary in the
  Hermes guide would save the next team that read.
- Nemotron Super with a little thinking was the right agent model for us: 40
  of 40 tool calls, about $0.05 for a ten-turn conversation, and the
  in-workout coach answering in Hebrew and English in 1 to 2.5 s. Nemotron
  Ultra's memory extraction found every expected fact in our evaluation set.
- One thing to know: a reasoning model can spend its whole token budget
  thinking and return empty content, which an agent loop reads as "nothing to
  say".

## The demo video (NH-91)

**Rules** (§2): public on YouTube, **under 3 minutes**, the voiceover explains
how **Token Factory and Nemotron** are used, and no third-party music or
trademarks. From the plan: show memory across sessions, the assistant acting
(a tool-driven change and a check-in), a Tavily answer with sources and
per-user isolation, and say what's ours versus upstream.

**Recording** (2026-10-24): screen recording on the recording device,
signed in to the **team demo account** (label `App Review` in
`private.demo_accounts`) — never a judge account. Its address never appears
in the video: it signs anyone in at once, so type it with the recording
paused, or blur it in editing. A terminal shot is from the VPS with nothing
secret visible (no env files, no Secrets, no tokens in URLs). Either no
music, or music we made. Name NVIDIA, Nebius, OpenShell, Hermes and Tavily
in speech and captions; no other companies' logos.

The seeded history the shots rely on (`private.seed_demo_account`, then the
memory run): the left shoulder that dislikes overhead pressing (pinned), 45
minutes on Thursdays, the brother's wedding in June, dumbbells for incline
pressing, a new gym with a belt squat, and two plans, Upper Body and Lower
Body.

About 300 words of voiceover — a little over two minutes at a calm pace,
which leaves time on screen for the replies to arrive. Cut the waits in
editing, not the lines about Token Factory and Nemotron; if it runs long, the
tool-driven change goes first:

| Time | Shot | Voiceover |
|---|---|---|
| 0:00–0:12 | Sign-in: email sign-in, the demo address (hidden), straight into the app | Notch is a strength coach on the App Store. For this hackathon we gave every lifter their own always-on coach — one that remembers them, acts for them, and keeps what it knows about them private. |
| 0:12–0:40 | Assistant tab: "What do you know about me?" The reply names the shoulder, Thursdays, the wedding. Then the header button: *What the coach remembers* | It remembers you across sessions. Every night, NVIDIA Nemotron Ultra on Nebius Token Factory reads the day's chats and workouts and distils short facts. The scoring is in code, not in the model, and every fact is yours to see — and to delete. |
| 0:40–0:55 | "Make my bench press 4 sets of 6 this week." The reply states the change; the plan shows it. "Undo that." | It acts for you. Nemotron Super drives the agent's tool calls: it changes sets, reps, rest or intensity — never the movement — says exactly what it changed, and anything can be undone. |
| 0:55–1:15 | "Which vegetarian foods have 30 grams of protein per serving?" Tap a source | It looks things up with Tavily and shows where each answer came from — and its rules keep anything personal out of the search. |
| 1:15–1:50 | My Coach: generate a plan, the plan appears. Start the Upper Body workout: the coach's intro; log a set ("82.5 for 8, 8, 7"); ask "My shoulder feels off today — what should I swap?" | The coach inside the workout runs on Nemotron Super on Token Factory too: it writes the plan, opens each workout, and answers mid-set — knowing the shoulder it has to work around. |
| 1:50–2:08 | The lock screen: the daily check-in arrives as a notification; open it into the chat | And it doesn't wait to be asked: each morning it checks in about today's workout, using what it remembers — or stays quiet when there's nothing useful to say. |
| 2:08–2:40 | The architecture diagram; then the VPS terminal listing one sandbox per user | Under the hood, every user has their own Hermes Agent, in their own NVIDIA OpenShell sandbox, on a Nebius VM. The agent never sees an API key: OpenShell adds the Token Factory key only on requests to Token Factory. When the machine is full, people wait their turn — no one ever shares a sandbox. |
| 2:40–2:52 | The repository README, "What we built, and what we build on" | OpenShell, Hermes Agent and NemoClaw are the runtime. The relay, the sandbox manager, the tools, the memory pipeline and the app are ours — and every Token Factory call has a daily spending ceiling. |
| 2:52–2:58 | The Assistant tab | Notch: a coach that knows you, and works for you. |

**Before recording** (the morning of the day, in this order):

1. **The app is closed** on every other device signed in to the demo account.
2. **My Coach's ceiling for the day** (D-34: "the day the demo video is
   recorded, coach goes up for that day"): `ASSISTANT_SPEND_CEILING_CENTS_COACH=60`
   on the test project, unset the next morning (a secret change gives every
   function a new version, `docs/budget-runbook.md`). Prod's 35 cents is
   about 60 assistant replies; raise `ASSISTANT_SPEND_CEILING_CENTS_PROD` the
   same way only if the retakes run past that.
3. **Re-seed the demo account** (the `dev-test-scenario-accounts` skill,
   "Demo and judge accounts"): the history moves to the day, and the chat,
   the facts and any test sessions are cleared.
4. **Build its facts the same hour:** `memory-nightly` (`docs/assistant-ops.md`,
   "Run it now", about 1 cent for one account). Check them: six or so, the
   shoulder pinned, the wedding long_term; delete one taken from a coach's
   line or small talk (NH-65's known limitation).
5. **Check the sandbox** instead of sending a warm-up message, which would
   show in the chat: the account is in prod's `SANDBOX_KEEP_RUNNING`, so its
   sandbox is already running — `Ready` in `kubectl -n notch-prod get sandboxes`.
6. **The recording device:** notifications for Notch Coach allowed, Focus and
   Do Not Disturb off. Sign in to the demo account off camera, pick English
   if the language screen shows (the choice is per device; the seed's coach
   is English), then close the app fully and open it again: that cold start
   registers the device's push token. Check the token is in `push_tokens`.
   A token stays until it's deleted — signing out doesn't remove it — so
   every device signed in before gets the check-in too.
7. **The check-in shot:** with the recording running and the app in the
   background, queue one check-in by hand (one insert into `assistant_jobs`,
   kind `checkin`, `docs/assistant-ops.md`, "Daily check-in"; the re-seed
   clears the day's 06:00 UTC one, so the day's dedup key is free). It
   arrives in about 10 seconds.
8. **After recording:** the length (under 3:00 with the title card), captions
   on, visibility **public**, the link in Devpost and the README, and the
   day's spend checked. The plan generated on camera stays on the account
   until the re-seed before judging.

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
- [ ] Prod didn't run into its daily ceiling, which stops every judge's coach
      until 00:00 UTC. The health check alerts while it lasts; days that came
      close, with the default $1 ceiling:
      `select day, round(cost_cents) as cents from public.assistant_spend where bucket = 'prod' and day > current_date - 7 and cost_cents >= 90 order by day;`
      If judges hit it, raise `ASSISTANT_SPEND_CEILING_CENTS_PROD` as far as
      the Monday forecast allows.
- [ ] Judge accounts untouched: **never re-seed during judging** — it wipes
      what a judge did. The last re-seed is on submission day, after the final
      demo run.

Fixed dates:

- **2026-10-26:** re-seed every demo and judge account
  (`dev-test-scenario-accounts` skill), run the memory job at once and check
  every account has facts with a pinned health one (the skill has the query;
  the oldest seeded workout leaves the job's 14-day window by the second
  night), then submit.
- **2026-11-15:** the move to member B's credits (NH-96), a week-long check
  after it.
- **2026-12-01:** resize to 4 vCPU / 16 GiB; confirm the prod sync windows are
  active (`argocd --core proj windows list notch` and `… platform`).
- **Incident contact:** ⟨who answers the health check's emails, per week⟩.
