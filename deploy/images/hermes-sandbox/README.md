# Hermes sandbox image

Every user gets their own OpenShell sandbox running Hermes Agent (D-25, D-26).
This directory is that sandbox's image. What's here now is the **coach
profile** (NH-40, NH-45); the Dockerfile comes with the spike (NH-21), and the
Images workflow starts building it as soon as it exists (NH-37).

```
profile/
  SOUL.md             who the coach is and the rules it never breaks — slot #1 of Hermes' system prompt
  config.yaml         model, the D-29 tool allowlist, the Notch MCP server, Tavily search, memory, API server
  install-profile.sh  copies the two files into $HERMES_HOME on every start
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
| `TOKEN_FACTORY_MODEL` | The Nemotron model id (NH-22) | Per environment, plain value |
| `NOTCH_TOOLS_URL` | `https://<project-ref>.supabase.co/functions/v1/notch-tools` | Per environment, plain value |
| `NEBIUS_API_KEY` | Token Factory key — dev and prod keys differ (D-34) | OpenShell provider: the sandbox sees a placeholder; the proxy puts the real key in, only for the Token Factory host (D-28) |
| `TAVILY_API_KEY` | Tavily key | OpenShell provider, placeholder, only for the Tavily host |
| `NOTCH_TOOL_TOKEN` | The user's own tool token (NH-41) | OpenShell provider per user, placeholder, only for the `notch-tools` URL (NH-55) |
| `API_SERVER_KEY` | Bearer key for this sandbox's Hermes API | Generated per sandbox by the sandbox manager, which gives the same value to the relay (NH-55). Real value: it only opens this user's own agent |

## For the Dockerfile (NH-21)

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

**The options for our image**, in order of preference. The spike picks one:

1. **Their image as the base, our start command.** `FROM` NemoClaw's built
   Hermes image: their Dockerfile built by our CI, or a published tag if one
   exists. Add the profile and start with the relay's default command, which
   installs the profile and then runs `hermes gateway run` in the foreground.
   This keeps every NemoClaw patch, and it skips `nemoclaw-start`'s hash check
   (our profile *is* the config) and its dashboard (RAM, D-31). To check:
   - whether the `hermes` wrapper accepts `API_SERVER_KEY` in the environment;
   - how OpenShell's `--expose` reaches the port. If it needs a non-loopback
     listener, set `API_SERVER_HOST=0.0.0.0` (the key still guards it), or use
     socat like theirs.
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
