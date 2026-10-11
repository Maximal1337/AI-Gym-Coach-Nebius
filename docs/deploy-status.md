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

## 1. Current state — 2026-10-11

Spike item 1 of 9 is done (NH-21 and O-11). Next: item 2, the provider
profiles.

**On the VPS** — one Nebius VM, Ubuntu 24.04, 2 vCPU / 8 GiB / 60 GiB (NH-30),
bootstrapped on 2026-10-09 with `deploy/bootstrap/bootstrap.sh`.

| What | Version | State |
|---|---|---|
| k3s | `v1.36.4+k3s1`, single node, without traefik, servicelb and metrics-server | Running |
| Argo CD | `v3.5.3`, core install | All six applications Synced and Healthy |
| Agent Sandbox controller | `v1.0.4` | Running |
| OpenShell | Chart and gateway `0.1.2`; CLI `0.1.2` in the relay image | One gateway per environment, both healthy (O-11) |
| Relay | `ghcr.io/maximal1337/notch-relay` | Running in `notch-dev` and `notch-prod` |
| Sandbox image | `ghcr.io/maximal1337/notch-hermes-sandbox`: NemoClaw's `hermes-sandbox` `v0.0.130` (Hermes Agent `0.21.3`) plus our profile, start script and one patch | The default sandbox image of both gateways |

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
| Global sandbox policy | Set, from `deploy/platform/openshell/sandbox-policy.yaml` | **Not set** |
| Provider profiles | None imported | None |
| Providers | None | None |
| Sandboxes | None | None |

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
One sandbox with an idle Hermes took about 220 MiB, plus 15 MiB for its
supervisor pod (NH-21). The real numbers come from NH-25.

**Works**

- Deploying: a push to `main` reaches the cluster through CI, the Images
  workflow and Argo CD, with nobody touching the VPS.
- Two gateways side by side in one cluster (O-11).
- A sandbox created the way the relay's manager creates one (the default
  image, no extra flags) is ready in 27 s, and Hermes answers through the
  gateway 40 s after the create. `/v1/*` needs that sandbox's key: 200 with it,
  401 without it or with a wrong one. The gateway refuses a caller without the
  client certificate (NH-21, 2026-10-11).
- Token Factory itself: Nemotron Super, Ultra and Lightning pass the tool
  round trip, `tool_choice: "required"` and JSON-schema output with thinking
  off; Nano fails all three (NH-28, 2026-10-09).
- Nightly backups and the health check.

**Doesn't work yet**

- The agent has no model, no search and no tools: neither gateway has provider
  profiles or providers (spike items 2–4).
- Nobody can chat: both relays are static with an empty map, and the sandbox
  manager is off (items 5–6).
- A sandbox in `notch-prod` wouldn't start: no global policy there.
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
of this file.

| # | Step | NH | Owner | Blocked by | Due |
|---|---|---|---|---|---|
| 2 | Provider profiles imported into the dev gateway, `openshell profile lint` clean | NH-33 | Claude | — | *10-12* |
| 3 | `token-factory` provider in dev: a Nemotron reply, an MCP tool end to end, `reasoning_effort: "none"` reaching the model through the router | NH-22 | Claude; Max enters the key and checks the usage page in Token Factory | Item 2 | *10-12* |
| 4 | `tavily` provider: `web_extract` unavailable, an answer that cites its sources | NH-23 | Claude; Max enters the key | Item 3; the Tavily key (NH-03) | *10-12* |
| 5 | Relay to sandbox in static mode: a full round trip for test account A | NH-24 | Claude; Max edits `dev.env` and sends the message | Item 3 | *10-12* |
| 6 | The sandbox manager in dev: create, stop and start keeping the memory, delete, idempotency | NH-29 | Claude; Max removes the static map from `dev.env` afterwards | Item 5 | *10-13* |
| 7 | Measurements: turns, cold start, a three-hour soak, memory, and 4 prod + 2 dev sandboxes at once (O-12) | NH-25 | Claude; Max pauses the health check's alerts for the soak | Item 6. No pushes to `main` during the soak: each one restarts the relay and both gateways | *10-13* |
| 8 | Isolation: the probe from inside A's sandbox, the agent probe with A, B and B's canary, NodePort and LoadBalancer checked again with live sandboxes | NH-26 | Claude; Max plants the canary in B's facts | Item 6 | *10-14* |
| 9 | Go/no-go against the O-04 thresholds, and the VPS size (D-31) | NH-27 | Max decides; Claude writes the summary | Items 4, 7 and 8 | *10-14* |

**After the spike**

| Step | NH | Owner | Blocked by | Due |
|---|---|---|---|---|
| The global policy, profiles, providers and the manager in prod | NH-33, NH-55 | Claude; Max enters the prod keys | A go in NH-27 | *10-15* |
| One idempotent script that sets a gateway up (policy, profiles, providers), so a new or restored gateway needs one command | NH-33 | Claude | Items 2–4, which settle what it has to do | *10-15* |
| TestFlight build submitted to Beta App Review | NH-72 | Partner | The team's go-ahead for the EAS build | 10-16 |
| The move to the main Supabase project: the same `RELAY_SECRET` values there as in the env files, every sandbox created again (tool tokens and sandbox records belong to a project), `SUBSCRIPTION_PAUSED` checked | NH-06, NH-51 … NH-53 | Partner (Supabase), Max (env files), Claude (the check) | The NH-06 rollout; migrations, secrets and functions on the main project | *10-17*, before NH-73 |
| The nightly memory job on Token Factory: first real run, the golden set | NH-61, NH-63, NH-65 | Max; partner provides the key (D-24) | Item 3; the main Supabase project | 10-18 |
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

- Do the network rules a provider adds still apply under a global policy?
  (item 3)
- Does Hermes look anything up outside Token Factory during a turn, such as a
  model's context length? (item 3)
- How does a new sandbox image reach sandboxes that already exist? (item 6)
- Does "Sandbox list failed" grow under load? (item 7)
