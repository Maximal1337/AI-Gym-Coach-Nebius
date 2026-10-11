# Hermes sandbox image

Every user gets their own OpenShell sandbox running Hermes Agent (D-25, D-26).
This directory is that sandbox's image: NemoClaw's published Hermes sandbox
image plus the **coach profile**, our start script and one patch to Hermes
(NH-21, NH-40, NH-45). The Images workflow builds it with the relay after every
green CI run on `main` (NH-37).

```
Dockerfile                FROM NemoClaw's Hermes sandbox image, pinned by digest; adds what's below
patch-hermes-api-key.py   build step: Hermes' API server also takes its key from X-Hermes-Api-Key
profile/
  SOUL.md             who the coach is and the rules it never breaks — slot #1 of Hermes' system prompt
  config.yaml         model, the D-29 tool allowlist, the Notch MCP server, Tavily search, memory, API server
  install-profile.sh  on every start: the two files into $HERMES_HOME, and the API key into its .env
  start-hermes.sh     the sandbox's command: installs the profile, then runs Hermes
```

In the image all of it is under `/opt/notch`, directories 0755 and files 0644
(scripts 0755): `/sandbox` is hidden by the sandbox's own volume.

Tests in `services/relay/src/hermes-profile.test.ts` pin what the rest of the
system relies on: the allowlist, the MCP tool list against `notch-tools`, no
secret in the config, the rules in SOUL.md, how Hermes is started, the patch.

## What is common and what is per user

SOUL.md and config.yaml are the same in every sandbox. What differs per user
comes with each request from the relay (`services/relay/src/prompt.ts`): reply
language and units, the coach's name, tone and accountability style, the
user's own style notes, and the facts Notch remembers about them. Hermes layers
that system message on top of SOUL.md.

## The sandbox's environment

| Variable | What it is | Where it comes from |
|---|---|---|
| `HERMES_HOME` | Hermes' home: memories, skills, sessions, and the installed profile | A path on the sandbox's own volume (`/sandbox/...`), so it survives restarts |
| `NOTCH_MODEL` | The Nemotron model id (NH-22) | The relay's `TOKEN_FACTORY_MODEL`, per environment, plain value. Not named `TOKEN_…`: a plain value under a credential-shaped name is what NH-26's probe flags |
| `NOTCH_TOOLS_URL` | `https://<project-ref>.supabase.co/functions/v1/notch-tools` | Per environment, plain value |
| `NEBIUS_API_KEY` | Token Factory key — dev and prod keys differ (D-34) | OpenShell provider: the sandbox sees a placeholder; the proxy puts the real key in, only for the Token Factory host (D-28) |
| `TAVILY_API_KEY` | Tavily key | OpenShell provider, placeholder, only for the Tavily host |
| `NOTCH_TOOL_TOKEN` | The user's own tool token (NH-41) | OpenShell provider per user, placeholder, only for the `notch-tools` URL (NH-55) |
| `API_SERVER_KEY` | The key of this sandbox's Hermes API, 64 lowercase hex characters | Derived per sandbox by the sandbox manager, which uses the same value as the relay (NH-55). Real value: it only opens this user's own agent. `install-profile.sh` writes it into `$HERMES_HOME/.env` (mode 0600), where Hermes reads it, and `start-hermes.sh` drops it from Hermes' environment |

`start-hermes.sh` adds `HOME=/sandbox`, `HERMES_SKIP_CHMOD=1` and
`HERMES_LAZY_INSTALL_TARGET=$HERMES_HOME/lazy-packages`: what NemoClaw's own
image and start script give Hermes.

## The image (NH-21)

The base is NemoClaw's published image
`ghcr.io/nvidia/nemoclaw/hermes-sandbox:v0.0.130` (590 MiB compressed, 121
layers, linux/amd64 and arm64), pinned by digest: Hermes 0.21.3 with every
NemoClaw patch for life inside OpenShell — MCP over HTTP through the sandbox
proxy, SQLite's temp store, restarts. The gateways' default sandbox image is
ours (`deploy/platform/openshell/values-*.yaml`, `sandbox.image`), with the tag
moved by CI.

Two things of NemoClaw's are not used:

- **Its start script** (`nemoclaw-start`, the image's entrypoint; OpenShell
  runs its own command instead). It checks `config.yaml` against a hash pinned
  at their build, so it refuses ours, and it starts Hermes' dashboard, which
  costs RAM (D-31).
- **Its `hermes` wrapper**, which stands between `hermes gateway` and Hermes
  itself (`hermes.real`). Before anything else it requires `/sandbox` to be
  `sandbox:sandbox` 0755 or 0770, `root:root`, or `root:sandbox` 1775. On a
  Kubernetes workspace volume `/sandbox` is `root:sandbox` 2777 — kubelet's
  `fsGroup` always sets the setgid bit — so the wrapper refused every start on
  the cluster ("/sandbox does not match a trusted owner/group/mode posture").
  `start-hermes.sh` runs `hermes.real gateway run` and sets up what the wrapper
  did besides its checks: never as root, `HOME`, `HERMES_SKIP_CHMOD`. The
  wrapper's check that no raw secret sits in the environment or in `.env` goes
  with it: a sandbox only ever gets OpenShell placeholders (D-28), and NH-26's
  probe (`deploy/spike/sandbox-probe.sh`) checks the environment from inside.

What the cluster needs for the image to start is in
[`deploy/README.md`](../../README.md#sandboxes-one-per-user-nh-55-nh-56): the
namespace's UID annotations (the image's `sandbox` user is 998:999) and the
gateway's global sandbox policy (`/opt/notch` and `/opt/hermes` readable).

### Our patch to Hermes

`patch-hermes-api-key.py` changes one upstream file at build,
`/opt/hermes/gateway/platforms/api_server.py`: in `_check_auth`, five lines so
the API key is also accepted from an `X-Hermes-Api-Key` header, compared in
constant time like the original. `Authorization: Bearer` keeps working; a
request with neither is still a 401.

Why: the relay reaches a sandbox's Hermes port through the OpenShell gateway,
and OpenShell 0.1.2's gateway removes `Authorization` from every request it
routes to a sandbox service — it treats the header as its own
(`crates/openshell-server/src/service_routing.rs`). Hermes reads its key
nowhere else and won't start its API server without one, so through the
gateway every `/v1` call was a 401. The relay sends the key in both headers.

The build fails unless the script finds its anchor exactly once inside
`_check_auth` and the patched method then passes the script's own cases (the
key in either header, a wrong key, none, a non-ASCII one). A new base image
whose Hermes changed there stops the build instead of shipping unpatched.
OpenShell 0.1.3 has a per-service bearer passthrough; when the chart moves to
it, delete the script and its Dockerfile step.

### Background requests Hermes makes on its own

Seen on the cluster, each one refused by the sandbox's policy, and now off in
`config.yaml`:

- every 20 minutes the gateway refreshes the `/model` picker's catalogs from
  `hermes-agent.nousresearch.com`, `openrouter.ai` and
  `portal.nousresearch.com` — `model_catalog.enabled: false`;
- at every start it tries to download the `tirith` command scanner from GitHub
  Releases — `security.tirith_enabled: false`; the terminal toolset is off.

Neither is a model call or carries user data, and the policy refuses them
either way: a sandbox reaches only the hosts its providers allow.

### Moving to a new base image

- Read what changed in NemoClaw's `agents/hermes` and in Hermes' `_check_auth`.
- `@HERMES_BINARY@` in the provider profiles is `/usr/bin/python3.13`: what
  OpenShell names as the process making Hermes' requests (its deny log says
  so). A new Python minor version changes it.
- Then point the gateways at the image (see ../../README.md, "The Hermes
  sandbox image").

## Verified only in a real sandbox

Written against Hermes Agent's documentation (v2026.9.24) and OpenShell 0.1.2;
the spike and NH-26 check them live:

- `${VAR}` substitution in `model.default`, the MCP `url` and `headers`.
- Only the four toolsets are offered (`GET /v1/toolsets` with the API key).
- The OpenShell proxy resolves the three placeholders for their hosts and
  refuses them anywhere else (`credential_endpoint_mismatch`).
- A fact deleted in the app is gone from the next reply (NH-73).
