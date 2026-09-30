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
decrypt its stored provider credentials.

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
  gateway's `notch.app/role: gateway` label.

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
