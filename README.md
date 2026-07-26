# GymCoach AI

An AI agent that runs a lifter through their workout set-by-set, remembers every
rep across sessions, and pushes progressive overload. iOS app (Expo) + minimal
web surface (Next.js) + LangGraph agent service over Supabase.

Full system design: Linear → GymCoach AI — MVP → "System Design" document.

## Layout

| Path              | What                                                        |
| ----------------- | ----------------------------------------------------------- |
| `apps/mobile`     | Expo (React Native) iOS app — the product surface           |
| `apps/web`        | Next.js site — marketing / config / future billing          |
| `services/agent`  | LangGraph agent service — the only thing that talks to LLMs |
| `packages/shared` | Design tokens + domain types shared by all of the above     |
| `supabase`        | Postgres migrations (schema + RLS)                          |

## Development

```sh
pnpm install
pnpm typecheck        # all workspaces
pnpm --filter @gymcoach/agent dev    # agent service on :8787
pnpm --filter @gymcoach/web dev      # website
pnpm --filter @gymcoach/mobile start # Expo dev server
```

## Non-negotiables (see System Design doc for the full list)

- Clients never call the LLM directly — everything goes through the agent
  service (usage caps, prompt assembly, kill switch live there).
- All client DB access is row-scoped via RLS. Mutations go through Edge
  Functions with service_role, with two deliberate carve-outs: a user may
  bootstrap/update their own profile row (locale only, column-granted) and
  edit their own coach persona. Consent fields and everything else are
  server-written only.
- The active workout session must work offline; sets queue locally and sync.
- Coach replies are single complete messages, generated in the user's language.
