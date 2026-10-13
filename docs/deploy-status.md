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

## 1. Current state — 2026-10-13

Spike items 1 to 3 of 9 are done: NH-21 with O-11, the provider profiles on
the dev gateway, and NH-22 — in a sandbox Nemotron answers through Hermes and
uses the Notch tools. Next: item 4, the `tavily` provider, which starts with
Max entering the key.

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
| Relay mode | `RELAY_SANDBOXES=static`, no sandbox mapped | The same |
| Relay to Supabase | Polling, no errors | The same |
| Relay to its gateway | Registered (`Status: Connected`) | The same |
| Global sandbox policy | Set, from `deploy/platform/openshell/sandbox-policy.yaml` with its three network rules; kept across gateway restarts | **Not set** |
| Provider profiles | `token-factory`, `tavily` and `notch-tools` imported from `deploy/platform/openshell/profiles`, lint clean | None |
| Providers | `token-factory`, with the dev key | None |
| Sandboxes | None: the test ones are deleted after each item | None |

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
- What a turn costs: about 4,600 input tokens without tools and 9,400 with two
  tool calls, a handful of output tokens either way — $0.0014 and $0.003 at
  Super's list price. With the relay's own prompt and a history it is measured
  in NH-25.
- Token Factory itself: Nemotron Super, Ultra and Lightning pass the tool
  round trip, `tool_choice: "required"` and JSON-schema output with thinking
  off; Nano fails all three (NH-28, 2026-10-09).
- Nightly backups and the health check.

**Doesn't work yet**

- The agent has no web search: no `tavily` provider yet (item 4).
- Nobody can chat: both relays are static with an empty map, and the sandbox
  manager is off (items 5–6).
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

Smaller ones, in the same commits: the policy opens `/opt/hermes` read-only
next to `/opt/notch`, because Hermes runs from there; the relay builds a
sandbox's service URL from its known form (CLI 0.1.2 can't print it as JSON)
and registers its CLI with the gateway in static mode too; Hermes' own
background fetches (the model catalog, a download from GitHub at start) are
off in the profile.

## 3. Next steps

Owners: **Max** (@Maximal1337), **partner** (@dorhaimbob-web), **Claude**
(runs the VPS work over SSH and writes the changes). Dates in *italics* are
targets proposed on 2026-10-11 and not agreed yet; the others are the plan's.

**The spike**, in this order. Each item ends with a short report and an update
of this file. Items 1 to 3 are done.

| # | Step | NH | Owner | Blocked by | Due |
|---|---|---|---|---|---|
| 4 | `tavily` provider: `web_extract` unavailable, an answer that cites its sources | NH-23 | Claude; Max enters the key | Max's SSH session for the key | *10-12* |
| 5 | Relay to sandbox in static mode: a full round trip for test account A | NH-24 | Claude; Max edits `dev.env` and sends the message | Item 4 | *10-12* |
| 6 | The sandbox manager in dev: create, stop and start keeping the memory, delete, idempotency | NH-29 | Claude; Max removes the static map from `dev.env` afterwards | Item 5 | *10-13* |
| 7 | Measurements: turns, cold start, a three-hour soak, memory, and 4 prod + 2 dev sandboxes at once (O-12) | NH-25 | Claude; Max pauses the health check's alerts for the soak | Item 6. No pushes to `main` during the soak: each one restarts the relay and both gateways | *10-13* |
| 8 | Isolation: the probe from inside A's sandbox, the agent probe with A, B and B's canary, NodePort and LoadBalancer checked again with live sandboxes | NH-26 | Claude; Max plants the canary in B's facts | Item 6 | *10-14* |
| 9 | Go/no-go against the O-04 thresholds, and the VPS size (D-31) | NH-27 | Max decides; Claude writes the summary | Items 4, 7 and 8 | *10-14* |

**After the spike**

| Step | NH | Owner | Blocked by | Due |
|---|---|---|---|---|
| The global policy, profiles, providers and the manager in prod | NH-33, NH-55 | Claude; Max enters the prod keys | A go in NH-27 | *10-15* |
| One idempotent script that sets a gateway up (policy, profiles, providers), so a new or restored gateway needs one command. From item 2: `profile import` refuses an id the gateway has, so the script updates those with their current `resource_version`. From item 3: the policy takes the same two placeholders as the profiles | NH-33 | Claude | Item 4, which settles the rest of what it has to do | *10-15* |
| TestFlight build submitted to Beta App Review | NH-72 | Partner | The team's go-ahead for the EAS build | 10-16 |
| The move to the main Supabase project: the same `RELAY_SECRET` values there as in the env files, every sandbox created again (tool tokens and sandbox records belong to a project), `SUBSCRIPTION_PAUSED` checked | NH-06, NH-51 … NH-53 | Partner (Supabase), Max (env files), Claude (the check) | The NH-06 rollout; migrations, secrets and functions on the main project | *10-17*, before NH-73 |
| The nightly memory job on Token Factory: first real run, the golden set | NH-61, NH-63, NH-65 | Max; partner provides the key (D-24) | The main Supabase project | 10-18 |
| End-to-end demo run on the TestFlight build | NH-73 | Partner, Max | Prod in manager mode, the main Supabase project, NH-72 | 10-20 |
| Demo video | NH-91 | Partner | NH-73 | *10-24* |
| Devpost submission | NH-92, NH-93 | Partner; README together | NH-72, NH-90, NH-91 | 10-26 (hard deadline 10-30, 10:00 PT) |
| The partner's access: a user of their own on the VPS (their key, sudo) and the **Notch VPS** entry in the password manager | NH-34, NH-96 | Max | — | Before the restore drill |
| Restore drill on a fresh host | NH-34 | Claude; partner creates the host | Prod in manager mode; the partner's access | Before 11-15 |
| The VPS moves to the partner's credits | NH-96 | Partner creates the VPS; Claude restores | The restore drill | 11-15 |
| Resize to 4 vCPU / 16 GiB for judging; prod syncs frozen | NH-96, D-32 | Partner | The move | 12-01 |
| Weekly checks: VPS, TestFlight build, credits, spend | NH-95 | Both | NH-93 | Weekly until 12-15 |

**The partner can start now**, without waiting for the spike:

- **NH-02** — register the team on Devpost and confirm eligibility.
- **NH-06** — the rollout on the main Supabase project (steps in §0 of the
  plan). The move to the main project waits for it.
- **The TestFlight build** (NH-72): the checklist in
  [`submission.md`](./submission.md#the-testflight-build-nh-72), starting with
  the version question.
- **The video script** (NH-91): the draft in
  [`submission.md`](./submission.md#the-demo-video-nh-91); the parts that don't
  depend on the spike's numbers can be final.

**Open questions the spike carries**

- How does a new sandbox image reach sandboxes that already exist? Seen so
  far: a running sandbox keeps the image it was created with, and lives
  through restarts of the relay and of its gateway. (item 6)
- Does "Sandbox list failed" grow under load? (item 7)
- What does a ten-turn conversation cost with the relay's own prompt, the
  facts and a history? (item 7, against O-04's $0.05)
- Does the proxy put a provider's key only into requests for that provider's
  host? (item 8)

Answered in item 3: provider rules are not added under a global policy, so
they are in the policy itself (deviation 7); `/usr/bin/python3.13` is what the
proxy sees Hermes as; and with Token Factory as our own provider entry Hermes
looks nothing up outside Token Factory — the built-in provider asked
`models.dev` at every start, and was refused.
