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

- Build from NemoClaw's Hermes blueprint layers — its docs say a custom image
  must keep them, not just start from the base image.
- `COPY profile/ /opt/notch/hermes-profile/` and run
  `/opt/notch/hermes-profile/install-profile.sh` before Hermes starts, on every
  start: `$HERMES_HOME` is on the persistent volume, so a profile baked into it
  once would go stale after the next image.
- Start Hermes' gateway so the API server (port 8642) is up; `config.yaml`
  enables it.
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
