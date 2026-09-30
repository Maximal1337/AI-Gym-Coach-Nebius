# Cluster deployment

The coach assistant's server side runs on one Nebius VPS: a single-node k3s
cluster that Argo CD keeps in sync with this directory on `main`
([plan](../docs/nebius-hackathon-plan.md) D-31, D-32, NH-36, NH-37).
Nothing on the VPS accepts inbound traffic except SSH (D-27): Argo CD pulls
from GitHub, images come from GHCR, and the relay pulls work from Supabase.

```
GitHub main ── CI green ── Images workflow ── GHCR (notch-relay, later notch-hermes-sandbox)
     │                           └── commits the new tag to deploy/  [skip ci]
     ▼
Argo CD (core) on the VPS ── root ── deploy/argocd
                                      ├─ projects.yaml      platform + notch, prod sync window
                                      ├─ repositories.yaml  OCI Helm repo for OpenShell
                                      └─ apps/
                                           agent-sandbox    wave -10  deploy/platform/agent-sandbox
                                           notch-dev/prod   wave   0  deploy/notch/overlays/<env>
                                           openshell-dev/prod wave 10 OpenShell chart + deploy/platform/openshell
```

| Path | What it is |
|---|---|
| `bootstrap/bootstrap.sh` | Fresh Ubuntu 24.04 → k3s + Argo CD core + the root Application. Also the first step of the move to a new host (NH-96) |
| `bootstrap/secrets.sh` | The only way secrets get into the cluster: from `/etc/notch/<env>.env` on the VPS |
| `argocd/` | Everything the root Application syncs |
| `platform/agent-sandbox/` | The Agent Sandbox controller and CRDs, pinned release |
| `platform/openshell/` | OpenShell gateway values, shared and per environment |
| `notch/base/` | The relay and the NetworkPolicies; the relay's image tag |
| `notch/overlays/{dev,prod}/` | The namespace and `RELAY_ENV` per environment |
| `ops/` | On the host, outside Argo CD: nightly backups, the restore onto a new host, the health check every 5 minutes (NH-34, NH-35) |

Pinned versions: k3s `v1.36.4+k3s1` and Argo CD `v3.5.3` (bootstrap.sh),
Agent Sandbox `v1.0.4` (platform/agent-sandbox), OpenShell chart `0.1.2`
(argocd/apps/openshell-*.yaml). Upgrades are commits that change a pin.

## First run

On the VPS, as the `claude` user (sudo), in a clone of this repository.
The host must already be hardened (NH-31): the script refuses to install k3s
without an active ufw, because k3s listens on 6443 on every interface.

```bash
sudo deploy/bootstrap/bootstrap.sh
```

Then the secrets, one env file per environment, written on the VPS only:

```bash
sudo install -d -m 700 /etc/notch
sudo cp deploy/bootstrap/secrets.env.example /etc/notch/prod.env
sudo chmod 600 /etc/notch/prod.env
sudoedit /etc/notch/prod.env
sudo deploy/bootstrap/secrets.sh prod /etc/notch/prod.env
```

Same for `dev`. The relay secret must match the Supabase Edge Function secret
`ASSISTANT_RELAY_SECRET_DEV` / `_PROD`. `secrets.sh` also creates each
gateway's credential key-encryption key once and prints how to read it:
**copy it off the VPS right away** — without it, a restored gateway can't
decrypt its stored provider credentials. The full list of what the team keeps
off the VPS is under [Backups](#backups-and-restore-nh-34).

Then backups and the health check:

```bash
sudo deploy/ops/install.sh
```

The relay image is published by CI to `ghcr.io/maximal1337/notch-relay`.
GHCR makes a new package private; set it to public once (package settings on
GitHub), or the cluster can't pull it.

Check the sync:

```bash
argocd --core app list
kubectl get pods -A
```

## Day to day

- **Deploying** is pushing to `main`. After CI passes, the Images workflow
  builds, pushes and commits the tag; Argo CD applies it within about three
  minutes. `argocd --core app get notch-prod` shows what's live.
- **Rolling back** is `git revert` of the tag commit ("Deploy <sha> to the
  cluster"), pushed to `main`. Don't `kubectl edit`: self-heal reverts it.
- **Secrets** change only through `secrets.sh`, which restarts the relay.
- **The prod freeze** (D-32): from 2026-12-01 to 2026-12-15 Argo CD doesn't
  sync `notch-prod` or `openshell-prod` automatically. For an incident, a
  person can still sync by hand: `argocd --core app sync notch-prod`.
- **The Argo CD UI** isn't installed in the cluster. When needed, run it on
  the VPS bound to localhost and reach it through SSH:
  `ssh -L 8080:localhost:8080 claude@<vps>`, then on the VPS
  `argocd admin dashboard --port 8080`.

## Isolation

- **Between environments:** `notch/base/network-policies.yaml`. Every pod
  accepts connections only from its own namespace's gateway, and the gateway
  only from its own namespace. The rules never select a sandbox pod for more
  than that: NetworkPolicies add up, and OpenShell's own policies are what keep
  a sandbox's workload closed (supervisor-only ingress, no workload-initiated
  connections).
- **Between users:** OpenShell, one sandbox per user (D-26).
- **Egress:** the sandboxes go out only through their gateway's policy; the
  allowlist and the host firewall's outbound rules are NH-32.

## Checked only on the VPS

Written and reviewed on a laptop; these need the real cluster (NH-21, NH-26):

- k3s' kube-router policy controller enforces the policies above, and still
  lets the kubelet probe the gateway. If the gateway never gets ready after
  `network-policies.yaml` syncs, that's the first suspect.
- The OpenShell chart syncs through Argo CD: its Helm hooks (certificate
  generation) run as PreSync hooks.
- One gateway per environment in the same cluster (O-11).
- Sandbox pods carry `openshell.ai/managed-by=openshell` and never the
  gateway's `notch.app/role: gateway` label. The health check counts
  sandboxes by it.
- Every volume is k3s' local-path, under `/var/lib/rancher/k3s/storage`;
  `ops/backup.sh` refuses anything else.
- A restored gateway takes back its sandboxes and their volumes (the NH-34
  drill); otherwise the fallback under "Restoring onto a new host".
- `k3s crictl stats -o json` gives per-container memory in the shape
  `ops/health.sh` reads.

## Sandboxes: one per user (NH-55, NH-56)

The relay creates and runs every user's sandbox itself, through the
`openshell` CLI in its image (`services/relay/src/sandbox-manager.ts`):

- **First message** from a flagged user: a sandbox named
  `notch-<env>-<hash of the user id>` is recorded in Supabase with the digest
  of a freshly minted tool token, the token goes into a per-user OpenShell
  provider `<sandbox>-tools`, and the sandbox is created from the gateway's
  default image with the environment's shared providers, `HERMES_HOME` on its
  own volume and Hermes' API port exposed. A retry finds the same name and
  creates nothing twice.
- **Later messages** start the sandbox if it's stopped. Each sandbox's Hermes
  API key is derived from `SANDBOX_KEY_SECRET` and its name, so no key is
  stored anywhere.
- **Capacity** (D-31): at most 4 running in prod and 2 in dev. A user who
  doesn't fit waits — the job goes back to the queue with its attempt unspent
  (`assistant_defer_job`) and their messages stay in order — while the least
  recently used sandbox that isn't answering anyone is stopped to make room.
  Nobody is ever served from another user's sandbox.
- **Idle** sandboxes stop after 10 minutes (checked every minute).
- **Orphans**: every 15 minutes, sandboxes without an `assistant_agents` row —
  an account deletion cascades it away — are deleted, at most 3 per sweep,
  and their providers on the following sweep.

It stays off until the spike has proved it on this cluster: each overlay sets
`RELAY_SANDBOXES=static` (the spike's hand-made map). Turn dev to `manager`
first. Before that, per environment:

1. Import the provider profiles in `platform/openshell/profiles/`, replacing
   `@SUPABASE_HOST@` (`<project-ref>.supabase.co`) and `@HERMES_BINARY@` (the
   interpreter that runs Hermes in the image), then check them with
   `openshell profile lint`.
2. Create the shared providers `token-factory` (that environment's key, D-34)
   and `tavily` (NH-33).
3. Add `SANDBOX_KEY_SECRET` to `/etc/notch/<env>.env` and rerun `secrets.sh`.
   Back it up with the gateway key (NH-34): losing it locks the relay out of
   every existing sandbox.

Settled in the spike (NH-29), not guessed here: how the relay authenticates
to its gateway and reaches a sandbox's exposed Hermes port (the gateway's
service URL); the command that starts Hermes in the image; and how an image
update reaches sandboxes that already exist.

## Backups and restore (NH-34)

The only state on the VPS is the volumes in `notch-dev` and `notch-prod`:
each gateway's database (its sandboxes and their encrypted provider
credentials) and every user's sandbox workspace (Hermes' memories, skills and
sessions). The cluster itself is in Git; accounts, chat history and the facts
the app shows are in Supabase.

`ops/backup.sh` runs nightly at 01:30 UTC (`notch-backup.timer`). It copies
every volume without stopping anything — SQLite databases through SQLite's
online backup, so they're consistent even mid-write — and writes one archive
encrypted to the team's backup key: the newest 7 stay in `/var/backups/notch`,
and with `BACKUP_S3_*` set in `/etc/notch/ops.env` each also goes to Nebius
Object Storage.

**Kept off the VPS by the team** (password manager), never in an archive:

| What | Created by | Without it |
|---|---|---|
| The backup key (`/root/notch-backup-identity.txt`, once) | `ops/install.sh`, first run | No archive can be read |
| Each environment's `openshell-credential-kek` | `bootstrap/secrets.sh` | A restored gateway can't decrypt its provider credentials |
| `/etc/notch/dev.env`, `/etc/notch/prod.env`, including `SANDBOX_KEY_SECRET` | You | The relay can't call the restored sandboxes |
| `/etc/notch/ops.env` | `ops/install.sh`, from `ops/ops.env.example` | Only convenience: it's the bucket key and the ping URL |

Read secrets only in your own SSH session, not in one whose output someone
else records.

**Setup.** `sudo deploy/ops/install.sh` installs `age`, `jq` and `sqlite3`,
copies the scripts to `/usr/local/lib/notch-ops`, creates the backup key and
runs the first backup. Re-run it after pulling changes to `ops/`.

**Off-host copy** (optional; a few cents a month at $0.0147 per GiB): in the
VPS's own Nebius account, create a bucket in the VPS's region with a lifecycle
rule that deletes objects after 14 days, and a service account with write
access to it; put its access key and the bucket in `/etc/notch/ops.env`
(`BACKUP_S3_ENDPOINT=https://storage.<region>.nebius.cloud`).

**A backup now:** `sudo systemctl start notch-backup.service`, then
`journalctl -u notch-backup -n 50`.

### Restoring onto a new host

The restore drill (NH-34) and the move to member B's credits (NH-96) are the
same procedure. On the new host, hardened (NH-31), with the `claude` user and
a clone of this repository:

1. `sudo deploy/bootstrap/bootstrap.sh --no-root-app` — k3s and Argo CD, but
   nothing deployed yet.
2. In your own SSH session, from the password manager: the backup key at
   `/root/notch-backup-identity.txt`, each environment's credential key at
   `/root/kek-<env>.txt`, and `/etc/notch/<env>.env` (root, mode 600;
   `sudo install -d -m 700 /etc/notch` first).
3. `sudo deploy/ops/install.sh` — it finds the backup key and keeps
   encrypting to it; its first backup, of an empty cluster, is harmless.
4. The archive onto the host. For the move, straight from the old host:

   ```bash
   ssh <old> 'sudo cat /var/backups/notch/<newest archive>' | ssh <new> 'sudo tee /root/restore.tar.gz.age > /dev/null'
   ```

   For the drill, the newest archive from the bucket, or the same copy.
5. Put the volumes back, before anything can start on empty ones:

   ```bash
   sudo deploy/ops/restore.sh /root/restore.tar.gz.age /root/notch-backup-identity.txt prod
   ```

   Only `prod` for the move: `notch-dev` ends on 2026-11-14 (D-31). The script
   refuses a namespace that already has claims and never writes over a
   directory, and each claim comes back under its old name, pre-bound to its
   volume.
6. Secrets with the old credential key, then the root Application:

   ```bash
   sudo deploy/bootstrap/secrets.sh prod /etc/notch/prod.env --restore-kek /root/kek-prod.txt
   sudo kubectl apply -f deploy/bootstrap/root-app.yaml
   ```
7. Check: `argocd --core app list` all synced and healthy, the gateway lists
   the restored sandboxes, and a judge account's chat works end to end with
   its earlier context.
8. `sudo shred -u /root/notch-backup-identity.txt /root/kek-*.txt /root/restore.tar.gz.age`

**If the gateway doesn't take its sandboxes back** — the drill is where we find
out whether OpenShell keeps state beyond its database and the volumes — start
it empty: delete the gateway's claim and let Argo CD recreate it, recreate the
shared providers (NH-33), and delete the restored sandbox claims. The relay
creates each user's sandbox again on their next message, with a fresh tool
token. Users keep everything they see — chat history and facts are in Supabase
(D-30); only Hermes' own memories and sessions start over.

## Monitoring (NH-35)

`ops/health.sh` runs every 5 minutes (`notch-health.timer`) and reports to a
dead man's switch: a free [healthchecks.io](https://healthchecks.io) check.
Healthy runs ping it; a problem pings `/fail` with the report; no ping at all
(the VPS or k3s down) makes it alert too. It emails both members. Outbound
only (D-27).

**Setup:** create a check with period 5 minutes and grace 10 minutes, add both
members' email, put its ping URL in `/etc/notch/ops.env` as `HEALTHCHECK_URL`,
and re-run `sudo deploy/ops/install.sh`.

It's a problem when the disk is over 85%, memory available under 10%, or load
over 2 per CPU; k3s or the node is down; a deployment or StatefulSet isn't
ready; an Argo CD application is degraded or missing; a container is
crash-looping or can't pull its image; more sandboxes run than the cap (4 prod,
2 dev); the relay logged 5 or more errors in 10 minutes; or the last backup
failed or is over 26 hours old. A problem is reported once two runs in a row
see it, so a single pod restart doesn't page anyone. The limits are in
`ops/ops.env.example`.

The report also shows the running sandboxes per environment, memory per pod
(from the container runtime — there's no metrics-server), sandboxes restarted
at their memory limit, the relay's recent errors, applications out of sync and
the latest backup. The same report by hand:

```bash
sudo /usr/local/lib/notch-ops/health.sh
```

- **Queue length and failed jobs** live in Supabase, which the VPS can't read:
  [`docs/assistant-ops.md`](../docs/assistant-ops.md), "Queue right now".
- **Per-sandbox memory watchdog:** `SANDBOX_MEMORY` in each overlay (set from
  NH-25's soak test). OpenShell makes it the sandbox pod's memory request and
  limit, so a Hermes that keeps growing is killed at that size, and the relay
  starts the sandbox again on the next message. The cap times the limit must
  fit the RAM left for sandboxes, and it applies to sandboxes created after
  it's set.
- **Nebius billing alerts:** [`docs/budget-runbook.md`](../docs/budget-runbook.md).

## Adding the Hermes sandbox image (NH-21)

1. Put its Dockerfile in `deploy/images/hermes-sandbox/`, next to the coach
   profile already there (see [its README](images/hermes-sandbox/README.md)).
   From then on the Images workflow builds
   `ghcr.io/maximal1337/notch-hermes-sandbox` too.
2. In `platform/openshell/values-{dev,prod}.yaml`, point the gateway's default
   sandbox image at it, with the tag line marked for CI:

   ```yaml
   sandbox:
     image:
       repository: ghcr.io/maximal1337/notch-hermes-sandbox
       tag: unbuilt # image-tag: notch-hermes-sandbox
   ```

   Without the marker the deploy job fails on purpose: an image nobody points
   at would be built and never used.
