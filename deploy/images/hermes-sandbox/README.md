# Hermes sandbox image

Every user gets their own OpenShell sandbox running Hermes Agent (D-25, D-26).
This directory is that sandbox's image: NemoClaw's published Hermes sandbox
image plus the **coach profile** (NH-21, NH-40, NH-45). The Images workflow
builds it with the relay after every green CI run on `main` (NH-37).

```
Dockerfile            FROM NemoClaw's Hermes sandbox image, pinned by digest; adds the profile
profile/
  SOUL.md             who the coach is and the rules it never breaks — slot #1 of Hermes' system prompt
  config.yaml         model, the D-29 tool allowlist, the Notch MCP server, Tavily search, memory, API server
  install-profile.sh  on every start: the two files into $HERMES_HOME, and the API key into its .env
```

Tests in `services/relay/src/hermes-profile.test.ts` pin what the rest of the
system relies on: the allowlist, the MCP tool list against `notch-tools`, no
secret in the config, the rules in SOUL.md.

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
| `NOTCH_MODEL` | The Nemotron model id (NH-22) | The relay's `TOKEN_FACTORY_MODEL`, per environment, plain value. Not named `TOKEN_…`: see below |
| `NOTCH_TOOLS_URL` | `https://<project-ref>.supabase.co/functions/v1/notch-tools` | Per environment, plain value |
| `NEBIUS_API_KEY` | Token Factory key — dev and prod keys differ (D-34) | OpenShell provider: the sandbox sees a placeholder; the proxy puts the real key in, only for the Token Factory host (D-28) |
| `TAVILY_API_KEY` | Tavily key | OpenShell provider, placeholder, only for the Tavily host |
| `NOTCH_TOOL_TOKEN` | The user's own tool token (NH-41) | OpenShell provider per user, placeholder, only for the `notch-tools` URL (NH-55) |
| `API_SERVER_KEY` | Bearer key for this sandbox's Hermes API, 64 lowercase hex characters | Derived per sandbox by the sandbox manager, which uses the same value as the relay (NH-55). Real value: it only opens this user's own agent. `install-profile.sh` moves it into `$HERMES_HOME/.env`, and the start command drops it from the environment |

**NemoClaw's secret boundary.** Their `hermes` wrapper refuses to start the
gateway (`SECRET_BOUNDARY_REFUSED`) when the process environment holds a raw
value under any name matching `(^|_)(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|API)(_|$)`
— OpenShell's placeholders are fine. That's why the model id travels as
`NOTCH_MODEL`, and why `API_SERVER_KEY` lives in `$HERMES_HOME/.env`: the one
place it's allowed raw, and only as 64 lowercase hex characters in a file owned
by `sandbox:sandbox` with mode 0640 (0600 is refused), in a `.hermes` directory
of mode 0700, 0750 or 03770. Checked on 2026-10-04 by running their own
`validate-env-secret-boundary.py` from v0.0.130 against the relay's environment
(refused before the change, accepted after) and, in its installed mode, against
the `.env` that `install-profile.sh` writes as the `sandbox` user.

## The image (NH-21)

**Chosen on 2026-10-04: option 1 below**, on NemoClaw's published image
`ghcr.io/nvidia/nemoclaw/hermes-sandbox:v0.0.130` (590 MiB compressed, 121
layers, linux/amd64 and arm64), pinned by digest. It existed all along, so
there's nothing of theirs to build; its secret boundary is handled above. The
gateways' default sandbox image is ours (`deploy/platform/openshell/values-*.yaml`,
`sandbox.image`, the chart key read from OpenShell 0.1.2's chart), with the tag
moved by CI.

Left for the spike, on the cluster:
- the sandbox's user is `sandbox`, not root — the wrapper refuses to start the
  gateway as root — and `/sandbox` on the workspace volume is `sandbox:sandbox`
  with mode 0755 or 0770, which the boundary requires before it reads `.env`;
- how OpenShell's `--expose` reaches the port: if it needs a non-loopback
  listener, set `API_SERVER_HOST=0.0.0.0` (allowed by the boundary; the key
  still guards the port);
- `@HERMES_BINARY@` in the provider profiles (below);
- how long the first sandbox takes while the node pulls 590 MiB — the relay's
  liveness probe allows 5 minutes per poll loop.

**What NemoClaw's Hermes image does** — read on 2026-09-30 from
`agents/hermes/Dockerfile` and `start.sh` in
[NVIDIA/NemoClaw](https://github.com/NVIDIA/NemoClaw/tree/main/agents/hermes)
(Apache-2.0):

- It builds `FROM ghcr.io/nvidia/nemoclaw/hermes-sandbox-base`, pinned by
  digest, then patches Hermes for life inside OpenShell. The patches cover MCP
  over HTTP through the sandbox proxy, SQLite's temp store, the gateway's
  process identity and supervisor restarts. It also replaces `hermes` with a
  wrapper that enforces a boundary on secrets in the environment.
- User `sandbox`, working directory `/sandbox`, `HERMES_HOME=/sandbox/.hermes`:
  the same as the relay's `SANDBOX_HERMES_HOME` default.
- It generates `config.yaml` from build arguments and pins its hash in
  `/etc/nemoclaw/hermes.config-hash`. Its start script (`nemoclaw-start`)
  checks the config against that hash before starting the gateway, so a
  config replaced at start is refused.
- `nemoclaw-start` runs Hermes' API server on `127.0.0.1:18642` and forwards
  `0.0.0.0:8642` to it with socat. It sets the proxy to
  `http://10.200.0.1:3128`, and it also starts Hermes' dashboard.
- There's no ENTRYPOINT; OpenShell runs the start command.

**The options for our image**, in order of preference — option 1 is the one in use:

1. **Their image as the base, our start command.** `FROM` NemoClaw's built
   Hermes image: their Dockerfile built by our CI, or a published tag if one
   exists. Add the profile and start with the relay's default command, which
   installs the profile and then runs `hermes gateway run` in the foreground.
   This keeps every NemoClaw patch, and it skips `nemoclaw-start`'s hash check
   (our profile *is* the config) and its dashboard (RAM, D-31). The wrapper
   doesn't accept `API_SERVER_KEY` in the environment — answered above.
2. **Their start script with our config.** Bake our `config.yaml` in and
   rewrite the pinned hash in our layer. This keeps their guard, but what the
   hash covers has to be read from `runtime-config-guard.py`, and the
   dashboard stays unless it can be turned off.
3. **`hermes-sandbox-base` alone.** This loses the patches, and the
   MCP-over-proxy one likely matters for `notch-tools`. Last resort.

Whichever it is:

- `COPY profile/ /opt/notch/hermes-profile/`. The profile is installed on
  every start, because the workspace volume mounted at `/sandbox` hides
  whatever the image put under it, and a profile baked in once would go
  stale after the next image.
- `@HERMES_BINARY@` in the provider profiles is the executable OpenShell sees
  making Hermes' requests. Behind their wrapper that's likely Hermes'
  virtualenv Python: check with `ps` inside a sandbox.
- Then point the gateways at the image (see ../../README.md, "Adding the
  Hermes sandbox image").

## Verified only in a real sandbox

Written against Hermes Agent's documentation (v2026.9.24) and OpenShell 0.1.2;
the spike and NH-26 check them live:

- `${VAR}` substitution in `model.default`, the MCP `url` and `headers`.
- Only the four toolsets are offered (`GET /v1/toolsets` with the API key).
- The OpenShell proxy resolves the three placeholders for their hosts and
  refuses them anywhere else (`credential_endpoint_mismatch`).
- A fact deleted in the app is gone from the next reply (NH-73).
