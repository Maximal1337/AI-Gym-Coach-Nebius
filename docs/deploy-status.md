# Deployment status

The working board for the two of us (@Maximal1337, @dorhaimbob-web): what runs
on the VPS today, where we left the plan, and who does what next. It is updated
at the end of every spike item, in the same commit as that item's changes.

It doesn't repeat the [plan](./nebius-hackathon-plan.md) (the NH tasks, the D
and O decisions) or the [runbook](../deploy/README.md) (how each thing is
done); it points at them. The repository is public, so addresses, project
refs, check URLs, test accounts and keys are never written here: everything
specific to the environment is in the **Notch VPS** entry in the password
manager.

## 1. Current state — 2026-10-16

Spike items 1 to 6 of 9 are done: NH-21 with O-11, the provider profiles on
the dev gateway, NH-22 — Nemotron answers through Hermes and uses the Notch
tools — NH-23, web search through Tavily, with one question left open: the
agent links its sources only when asked (below), NH-24, a test account's
messages through the dev relay to its sandbox and back, and NH-29: the dev
relay runs the sandbox manager, which creates, stops, starts and deletes the
sandboxes itself. Next: long polling for the outbox, then item 7, the
measurements.

**On the VPS** — one Nebius VM, Ubuntu 24.04, 2 vCPU / 8 GiB / 60 GiB (NH-30),
bootstrapped on 2026-10-09 with `deploy/bootstrap/bootstrap.sh`.

| What | Version | State |
|---|---|---|
| k3s | `v1.36.4+k3s1`, single node, without traefik, servicelb and metrics-server | Running |
| Argo CD | `v3.5.3`, core install | All six applications Synced and Healthy |
| Agent Sandbox controller | `v1.0.4` | Running |
| OpenShell | Chart and gateway `0.1.2`; CLI `0.1.2` in the relay image | One gateway per environment, both healthy (O-11) |
| Relay | `ghcr.io/maximal1337/notch-relay` | Running in `notch-dev` and `notch-prod` |
| Sandbox image | `ghcr.io/maximal1337/notch-hermes-sandbox`: NemoClaw's `hermes-sandbox` `v0.0.130` (Hermes Agent `0.21.3`) plus our profile, start script, two patches to Hermes and a link for the CA bundle | The default sandbox image of both gateways |

The two image tags are the lines marked `# image-tag:` in
`deploy/notch/base/kustomization.yaml` and
`deploy/platform/openshell/values-{dev,prod}.yaml`. CI moves them on every push
to `main`, a docs-only one included, and each move restarts the relay and both
gateways.

| | `notch-dev` | `notch-prod` |
|---|---|---|
| Relay mode | `RELAY_SANDBOXES=manager`: the relay creates, starts, stops and deletes the sandboxes | `RELAY_SANDBOXES=static`, no sandbox mapped |
| Relay to Supabase | Polling, no errors; an empty claim waits 10 s before the next (deviation 14) | The same; 60 s |
| Relay to its gateway | Registered (`Status: Connected`) | The same |
| Global sandbox policy | Set, from `deploy/platform/openshell/sandbox-policy.yaml` with its three network rules; kept across gateway restarts | **Not set** |
| Provider profiles | `token-factory`, `tavily` and `notch-tools` imported from `deploy/platform/openshell/profiles`, lint clean | None |
| Providers | `token-factory` with the dev key, `tavily`, and the tool token of test account A, created by the manager | None |
| Sandboxes | Test account A's, created by the manager; it stops after 10 idle minutes and starts for the next message | None |

**Supabase.** Both relays work against a temporary test project, created on
2026-10-10 so the spike doesn't wait for the main one: migrations, function
secrets and five Edge Functions deployed, `SUBSCRIPTION_PAUSED=true`, two team
test accounts with the `assistant_chat` flag. The move to the main project is
in [Next steps](#3-next-steps).

**Host.** ufw denies incoming traffic except SSH, which is rate-limited; sshd
takes keys only; fail2ban and unattended upgrades are on. The cluster has no
NodePort or LoadBalancer service, and only port 22 answers from outside
(checked 2026-10-10; repeated with live sandboxes in NH-26).

**Backups** ([runbook](../deploy/README.md#backups-and-restore-nh-34)):
nightly at 01:30 UTC since 2026-10-10. The backup key was created again — the
first one had been saved wrongly — and the new one is checked: it decrypts a
fresh archive. Both gateways' `openshell-credential-kek` values in the password
manager match the cluster's. Archives made under the first key can't be read
any more; the rotation (the newest 7 are kept) drops them by itself, and until
then only the archives made since the change can be restored.

**Monitoring** ([runbook](../deploy/README.md#monitoring-nh-35)): the health
check runs every 5 minutes and reports to the dead man's switch; stopping k3s
raised an alert on 2026-10-10.

**Memory.** With no sandbox running: 1.8 GiB used, 6.1 GiB available of 7.9.
One sandbox with an idle Hermes takes 220 to 260 MiB, plus 16 MiB for its
supervisor pod; one left idle for 38 hours stood at 261 MiB. The real numbers
come from NH-25.

**Works**

- Deploying: a push to `main` reaches the cluster through CI, the Images
  workflow and Argo CD, with nobody touching the VPS.
- Two gateways side by side in one cluster (O-11).
- A sandbox created the way the relay's manager creates one (the default
  image, no extra flags) is ready in 27 s, and Hermes answers through the
  gateway 35 to 40 s after the create. `/v1/*` needs that sandbox's key: 200
  with it, 401 without it or with a wrong one. The gateway refuses a caller
  without the client certificate (NH-21, 2026-10-11).
- A turn inside such a sandbox, on the image as CI builds it (NH-22,
  2026-10-13). Nemotron Super answers through Hermes in 1 to 2 s. A turn that
  reads two things through the Notch MCP tools takes two model calls and 2.9 s,
  and the reply uses what the tools returned. The Token Factory key and the
  user's tool token never enter the sandbox: Hermes sends placeholders and
  OpenShell's proxy puts the real ones in. Every request carries
  `reasoning_effort: "none"`. The sandbox reached Token Factory and
  `notch-tools` and nothing else, and nothing was refused.
- Web search (NH-23, 2026-10-14). With the coach's profile in the prompt the
  agent searched for every question that needed it (12 of 12: research,
  nutrition facts, a supplement's safety, an exercise substitute) and never
  for small talk, and answered from what Tavily returned. The tools the model
  is given are exactly D-29's twelve, `web_search` the only web tool. A direct
  request from inside the sandbox to Tavily's `/extract`, `/crawl` or `/map`,
  or anything but `POST /search`, gets a 403 from OpenShell's policy, and any
  other host is refused outright.
- What a turn costs, with the coach's profile in the prompt (it wasn't in
  item 3's numbers, see deviation 12): about 5,800 input tokens and a handful
  of output tokens without tools — $0.0018 at Super's list price. A search
  adds a second model call carrying 7,000 to 8,500 characters of results: a
  turn with one search is 14,000 to 15,000 input and 150 to 250 output tokens,
  about $0.0045, and 1.5 s longer; two searches, 23,000. A request to open a
  page, which the agent can't do, became three searches and 40,000 tokens.
  With the relay's own prompt and a history it is measured in NH-25.
- The relay's round trip (NH-24, 2026-10-14). Test account A's messages, sent
  the way the app sends them, went from `assistant-send` through the dev relay
  to A's sandbox and came back as replies in `assistant_messages` 5 to 10
  seconds later: the plan question through the Notch tools, the follow-up
  with the conversation's history. A turn's reported usage covers all its
  model calls, so a search turn is charged both. Three turns took four model
  calls, 23,700 input and 370 output tokens: about $0.007.
- The sandbox manager in dev (NH-29, 2026-10-16). Test account A's first
  message made the relay record a new tool token, create A's tools provider
  and sandbox from the gateway's default image, and answer 52 s after the
  message: 27 s for the create, then Hermes' start while the job waited in
  the queue, and up to 10 s of polling at each claim. After 10 idle minutes
  the manager stopped the sandbox (its volume kept); the next message started
  it and was answered 25 s after it was sent. A skill the agent had saved
  before the stop came back after it, and the fact told in the first message
  was answered after the start (from the conversation the relay sends). A
  delete leaves no Sandbox object, pod, volume or host directory, and no
  provider; the next message created the sandbox again with a new token, and
  the tools worked. The orphan sweep deleted a sandbox without a mapping row
  on its own, and its provider one sweep later.
- A new sandbox image reaches only the sandboxes created after it: the image
  is written into each sandbox's `Sandbox` object at the create, and a stop
  and start reuse it. The runbook now has the procedure that points existing
  sandboxes at the current image; each takes it at its next start, volume and
  all, and a running one isn't interrupted (checked on dev).
- Token Factory itself: Nemotron Super, Ultra and Lightning pass the tool
  round trip, `tool_choice: "required"` and JSON-schema output with thinking
  off; Nano fails all three (NH-28, 2026-10-09).
- Nightly backups and the health check.

**Doesn't work yet**

- No sources under the coach's answers. The answers come from the search
  results, but the agent links a page only when asked: none of 8 answers in
  item 4 that didn't ask, none of 8 searched answers in item 5 (5 of them with
  the relay's own prompt), and 1 to 3 of 4 when the user asked. The
  `【1†L1-L8】` markers it sometimes writes instead are now dropped by the relay
  (`5a5efa0`); a URL inside one still becomes a source. Wording in the
  profile and a reminder from the relay each helped little, so the relay is
  to take the sources from Hermes' own search results (Next steps).
- With a conversation before it, the agent sometimes refuses a plain
  supplement question. "Is creatine safe to take every day, and what dose do
  studies use?" after a question about the plan was refused as "personalized
  supplement recommendations" in 2 of 4 turns, without a search, and the
  follow-up in the same way; on its own it was searched and answered 6 of 6
  times. The profile's rule against medical advice is read too widely; the
  decision is in Next steps (NH-45).
- The agent says it did what it didn't. In item 6 it told A it had "added
  your training time and equipment limit to your facts", and answered a
  request to save a skill with "Let me create that now" — no tool call either
  time, against the profile's rules 6 and 7. Asked outright to use its skill
  tool, it saved the skill, at the sixth attempt: Hermes refused five
  descriptions longer than 60 characters, and each retry was another model
  call.
- Hermes offers the agent NemoClaw's bundled skills too — `skills_list`
  returns ones for coding agents, email and social media next to the coach's.
  Whether they reach the prompt, and what they cost, is for item 8's dump.
- Only the team's accounts with a dev mapping can chat, in dev; prod has no
  manager yet.
- Nothing of this is on prod: its gateway has no global policy, no profiles
  and no providers, so a sandbox there wouldn't even start.
- Isolation is unverified (NH-26), nothing is measured (NH-25), and there's no
  go/no-go (NH-27, due 2026-10-04 in the plan).
- The host's outbound allowlist (NH-32).

**Known noise.** Each gateway logs "Sandbox list failed" about 15 times an hour
(6 to 22), the same in dev and prod, with no trend over 24 hours and no visible
effect. Counted again during the soak (NH-25).

## 2. Deviations from the plan

Decisions taken along the way, each with its reason and where it lives.

| # | The plan | What we did | Why | Commit |
|---|---|---|---|---|
| 1 | NH-31, §0: SSH only from our own addresses, in the security group and in the host firewall | The Nebius security group lets everything in. The host firewall denies everything except SSH, which is rate-limited; sshd takes keys only; fail2ban bans repeated failures. Only port 22 answers from outside, so D-27 holds. Recorded as D-35, proposed until the partner confirms it | We have no fixed addresses to allow | Host setup, not in Git; `bootstrap.sh` refuses to run without the firewall part |
| 2 | One Supabase project, the app's own | Both relays work against a temporary test project | The main project is the live app's and still waits for the NH-06 rollout. The spike runs the write tools and the injection probes for real, so it stays away from it, and doesn't wait for it | `/etc/notch/<env>.env` on the VPS, not in Git |
| 3 | NH-21: Hermes started through NemoClaw's `hermes` wrapper | The image's `start-hermes.sh` installs the profile and runs `hermes.real gateway run` | The wrapper refuses to start unless `/sandbox` has an owner and mode it trusts, and a Kubernetes volume (`root:sandbox`, mode 2777) isn't one of them. What the wrapper sets up besides is carried over: the home directory, no chmod of the Hermes home, where lazy installs go, never as root, the API key out of the environment. Its check for secrets in the environment is left to NH-26's probe | `eb75c58` |
| 4 | NH-21: upstream images as published, with our profile on top | One upstream function is patched when the image is built: Hermes' `_check_auth` also takes the key from `X-Hermes-Api-Key` (constant-time comparison, `Authorization` still works, the build fails if the patch doesn't apply). The relay sends both headers | OpenShell 0.1.2's gateway strips `Authorization` on the way to a sandbox's service, so the relay's key never arrived. OpenShell 0.1.3 can pass it through per service; upgrading is a separate decision, and the patch goes when we do | `eb75c58`, `00000ff` |
| 5 | Nothing about the user a sandbox pod runs as | Both namespaces carry `openshift.io/sa.scc.uid-range: 998/1` and `openshift.io/sa.scc.supplemental-groups: 999/1` | OpenShell's Kubernetes driver runs sandbox pods as 10001 unless the namespace says otherwise, and the chart has no value for it. The image's `/sandbox` belongs to 998:999; under 10001 a sandbox's first start fails | `5fb5dc5` |
| 6 | D-32: what runs on the cluster comes from Git through Argo CD | The sandbox policy is a file in Git, loaded into each gateway by hand with `openshell policy set --global` ([runbook](../deploy/README.md#sandboxes-one-per-user-nh-55-nh-56), step 1). Loaded on dev only so far | Policies, profiles and providers are records in the gateway's own database, not Kubernetes objects: Argo CD has nothing to sync. A changed file must be loaded again in each environment, and a gateway that starts empty needs all of it again — hence the setup script in Next steps | `5fb5dc5` |
| 7 | D-28: a sandbox's network rules come with the providers attached to it | The three rules — Token Factory, Tavily search, `notch-tools` — are written into the global policy, each a copy of its provider profile's endpoints and binary; a relay test fails when policy and profiles differ | Under a global policy OpenShell doesn't add the providers' rules: with none in the policy, Token Factory itself was refused. The keys still come from the providers | `b62b5df` |
| 8 | NH-21: upstream images as published (see 4) | A second function is patched when the image is built: the cron-restore drain gate NemoClaw adds to Hermes returns False. Same terms as the first patch: the build fails if the function is no longer what the patch expects | The gate holds every turn (HTTP 503) until `/sandbox/.nemoclaw` belongs to root. On a Kubernetes volume it belongs to the sandbox's user, and nothing in the pod runs as root. The NemoClaw rebuild the gate serves isn't used here, and Hermes' own drain marker still works | `09e8bba` |
| 9 | Nothing about the CA bundle | The image links `/etc/openshell-tls/ca-bundle.pem` to the CA bundle OpenShell's Kubernetes supervisor provides, and the start script refuses to start Hermes without it | NemoClaw's image points Python's CA bundle at that path, where another OpenShell driver mounts it. With the Kubernetes driver the path didn't exist, and every turn was a 500 | `09e8bba` |
| 10 | D-03, NH-22: thinking off through Hermes' `reasoning_effort` setting | Token Factory is an entry of our own in Hermes' config, whose `extra_body` puts `reasoning_effort: "none"` into every request; Hermes' tool search is off, so the seven Notch tools go to the model directly | Hermes' built-in Token Factory provider sends no reasoning setting for Nemotron, so the model kept thinking: 25 output tokens for a one-number answer, 4 now. Behind the tool search a two-tool turn took five model calls and 24,500 input tokens, and with thinking off the model didn't find the tools; now two calls and 9,400 | `09e8bba` |
| 11 | NH-55: sandbox names of 30 characters | `notch-<env>-` plus the base-36 tail of the user id's hash, 19 characters in all | OpenShell 0.1.2 refuses a longer name: the manager's first create would have failed. A collision can't put two users in one sandbox — the name is unique in the database, and the second record fails | `54a6667` |
| 12 | NH-40: the profile installed into `$HERMES_HOME` | `SOUL.md` also goes beside Hermes' state database, `$HERMES_HOME/runtime/` | Hermes builds the agent's identity from the `SOUL.md` beside `state.db`, which NemoClaw's image links into `runtime/`. Until this change every reply came from Hermes' default "Hermes Agent" identity, without the coach's character or one of its rules — item 3's turns included; the request dump showed it | `b21c26f` |
| 13 | NH-23: `web` among Hermes' disabled toolsets, to keep `web_extract` out | `web` is no longer disabled; only `search` (`web_search` alone) is enabled for the API server, and the policy refuses Tavily's `/extract` | A disabled toolset's tools are taken away from every session at the end, and `web` holds `web_search` too: the model never got a search tool at all | `b21c26f` |
| 14 | NH-54: the relay claims again 2 s after an empty claim | An empty claim waits 10 s in dev and 60 s in prod before the next one (`RELAY_IDLE_POLL_MS`), until long polling | Every claim is an Edge Function call: at 2 s the two relays made about 86,000 a day, against the 500,000 a month of the test project's free plan. A message now waits up to 10 s in dev before it's claimed | `697f099` |

Smaller ones, in the same commits: the policy opens `/opt/hermes` read-only
next to `/opt/notch`, because Hermes runs from there; the relay builds a
sandbox's service URL from its known form (CLI 0.1.2 can't print it as JSON)
and registers its CLI with the gateway in static mode too; Hermes' own
background fetches (the model catalog, a download from GitHub at start) are
off in the profile.

## 3. Next steps

Owners: **Max** (@Maximal1337), **partner** (@dorhaimbob-web), **Claude**
(runs the VPS work over SSH and writes the changes). Dates in *italics* are
proposed — set on 2026-10-13 at one spike item a day, moved a day on
2026-10-16, and not agreed between the two of us yet; the others are the
plan's.

**The spike**, in this order. Each item ends with a short report and an update
of this file. Items 1 to 6 are done.

| # | Step | NH | Owner | Blocked by | Due |
|---|---|---|---|---|---|
| — | Long polling for the outbox: a claim takes `wait_seconds` (about 25), and `assistant-outbox` checks the queue every 2 s or so and answers as soon as a job is there. The relay's `OUTBOX_TIMEOUT_MS` goes above the wait, with no pause after an empty answer, and `RELAY_IDLE_POLL_MS` back to its default (deviation 14). Deno tests for the function, tests for the relay | NH-52, NH-54 | Claude; Max deploys `assistant-outbox` | — | *10-17*, first |
| 7 | Measurements: turns, cold start, a soak overnight, memory, and 4 prod + 2 dev sandboxes at once (O-12) | NH-25 | Claude; Max pauses the health check's alerts for the soak | Long polling. No pushes to `main` during the soak: each one restarts the relay and both gateways | *10-17*, the soak overnight |
| 8 | Isolation: the probe from inside A's sandbox, the agent probe with A, B and B's canary, NodePort and LoadBalancer checked again with live sandboxes. The tool check reads the tools in the request that goes to the model, from Hermes' own dump: exactly D-29's, no shell, file, code, browser or fetch tool; the same dump shows the coach's profile is the prompt's identity, and which of NemoClaw's bundled skills reach the prompt | NH-26 | Claude; Max plants the canary in B's facts | — | *10-18* |
| 9 | Go/no-go against the O-04 thresholds, and the VPS size (D-31) | NH-27 | Max decides; Claude writes the summary | Items 4, 7 and 8 | *10-19* |

**After the spike**

| Step | NH | Owner | Blocked by | Due |
|---|---|---|---|---|
| The global policy, profiles, providers and the manager in prod | NH-33, NH-55 | Claude; Max enters the prod keys | A go in NH-27 | *10-20* |
| One idempotent script that sets a gateway up (policy, profiles, providers), so a new or restored gateway needs one command. From item 2: `profile import` refuses an id the gateway has, so the script updates those with their current `resource_version`. From item 3: the policy takes the same two placeholders as the profiles. From item 4: a provider's key goes in through standard input at a hidden prompt (runbook, step 3) | NH-33 | Claude | — | *10-20* |
| Sources from Hermes' own search results, so every searched answer shows its pages in the app — the demo and the video need them. After a turn the relay reads that turn's `web_search` results from the sandbox's session history (the `X-Hermes-Session-Id` it gets back, then `/api/sessions/<id>/messages` with the same key, both checked through the gateway in item 5: five results a search, each with a title and a URL) and attaches them as the reply's sources. The rules, each with a test: only this turn's `web_search` results; only `https`, no user info in the URL, a capped length; no duplicate of a link the reply has; at most three sources; titles cut short and stripped of markup; the results are untrusted content, so they go into the sources and never into the reply's text; the history is read with a timeout of about 3 s, and a failure neither fails nor holds up the turn. About 3 to 4 hours. Not taken: letting the model think (`reasoning_effort` low) — against D-03, dearer and slower | NH-23 | Claude | — | *10-19*, with item 9 |
| Rule 1 of the coach's profile, drawn more narrowly: general, evidence-based information on sports nutrition and supplements, with sources, is fine; individual medical advice isn't (item 5's refused creatine question). The same review takes rules 6 and 7: in item 6 the agent claimed to have added facts and promised to save a skill, calling no tool. The creatine question is in NH-73's checklist | NH-45 | Max and the partner decide; the partner writes the wording; Claude checks it on the spike's questions | — | Before NH-73 |
| The NH-06 rollout on the main Supabase project | NH-06 | Partner | — | *10-19* |
| TestFlight build submitted to Beta App Review | NH-72 | Partner | The team's go-ahead for the EAS build | 10-16 |
| The move to the main Supabase project: the same `RELAY_SECRET` values there as in the env files, every sandbox created again (tool tokens and sandbox records belong to a project), `SUBSCRIPTION_PAUSED` checked | NH-06, NH-51 … NH-53 | Partner (Supabase), Max (env files), Claude (the check) | The NH-06 rollout; migrations, secrets and functions on the main project | *10-21* |
| The nightly memory job on Token Factory: first real run, the golden set | NH-61, NH-63, NH-65 | Max; partner provides the key (D-24) | The main Supabase project | *10-22* |
| End-to-end demo run on the TestFlight build | NH-73 | Partner, Max | Prod in manager mode, the main Supabase project, NH-72 | *10-23* |
| Demo video | NH-91 | Partner | NH-73 | *10-24* |
| Devpost submission | NH-92, NH-93 | Partner; README together | NH-72, NH-90, NH-91 | 10-26 (hard deadline 10-30, 10:00 PT) |
| The partner's access: a user of their own on the VPS (their key, sudo) and the **Notch VPS** entry in the password manager | NH-34, NH-96 | Max | — | Before the restore drill |
| Restore drill on a fresh host | NH-34 | Claude; partner creates the host | Prod in manager mode; the partner's access | Before 11-15 |
| The VPS moves to the partner's credits | NH-96 | Partner creates the VPS; Claude restores | The restore drill | 11-15 |
| Resize to 4 vCPU / 16 GiB for judging; prod syncs frozen | NH-96, D-32 | Partner | The move | 12-01 |
| Weekly checks: VPS, TestFlight build, credits, spend | NH-95 | Both | NH-93 | Weekly until 12-15 |

**The partner can start now**, without waiting for the spike:

- **NH-02**, now — register the team on Devpost and confirm eligibility.
- **NH-06**, by *10-19* — the rollout on the main Supabase project (steps in
  §0 of the plan). The move to the main project on *10-21* waits for it.
- **The TestFlight build** (NH-72), submitted to Beta App Review by 10-16: the
  checklist in
  [`submission.md`](./submission.md#the-testflight-build-nh-72), starting with
  the version question.
- **The video script** (NH-91): the draft in
  [`submission.md`](./submission.md#the-demo-video-nh-91); the parts that don't
  depend on the spike's numbers can be final.

**Open questions the spike carries**

- Does "Sandbox list failed" grow under load? (item 7)
- What does a ten-turn conversation cost with the relay's own prompt, the
  facts and a history? (item 7, against O-04's $0.05)
- Does the proxy put a provider's key only into requests for that provider's
  host? (item 8)
- Which of NemoClaw's bundled skills reach the prompt, and what do they
  cost? (item 8, from the dump)
- A search returns five results (the tool's default), 7,000 to 8,500
  characters a time: would fewer keep the answers and cut a search turn's
  cost? (item 7)

Answered in item 6: a new image reaches only the sandboxes created after it;
the existing ones get it through the runbook's procedure, at their next start
and with their volume. A skill the agent saves goes into `$HERMES_HOME/skills`
and is there after a stop and start — `skills_list` finds it.

Answered in item 5: the relay's own turn goes through the gateway with the
sandbox's key in `X-Hermes-Api-Key`; Hermes' session id comes back through the
gateway, and the session's history, with every search's results, can be read
with the same key — the way to the sources above.

Answered in item 4: the model is given `web_search` and nothing that fetches a
page, and the policy refuses everything at Tavily but `POST /search`; the
Tavily key reaches the sandbox only as a placeholder, and the proxy fills it
in — the searches were answered.

Answered in item 3: provider rules are not added under a global policy, so
they are in the policy itself (deviation 7); `/usr/bin/python3.13` is what the
proxy sees Hermes as; and with Token Factory as our own provider entry Hermes
looks nothing up outside Token Factory — the built-in provider asked
`models.dev` at every start, and was refused.
