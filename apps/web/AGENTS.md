<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Deploying this app (Vercel)

The Vercel project (`dorhaimbob-webs-projects/web`) has its **Root Directory
set to `apps/web`** in project settings. This means every `vercel` CLI
command — `link`, `deploy`, `env`, etc. — must be run from the **monorepo
root** (`/Users/homemini/Projects/AI-Gym-Coach`), never from inside
`apps/web`. Running it from inside `apps/web` doubles the path and fails
with `The provided path ".../apps/web/apps/web" does not exist.`

If this directory isn't linked yet (no `.vercel/project.json` at repo
root), link it first:

```
vercel link --yes --project web --scope dorhaimbob-webs-projects
```

Then deploy to production from the repo root:

```
vercel deploy --prod --yes
```

This builds and aliases straight to production — no separate "promote"
step needed. Verify afterward with a plain `curl -o /dev/null -w '%{http_code}'`
against `https://web-dorhaimbob-webs-projects.vercel.app/<path>` (expect
`200`, not a redirect to a Vercel SSO login page — if you see that, the
project's Deployment Protection got re-enabled; disable it with
`vercel project protection disable web --sso`, this app has no auth wall
by design, `/privacy` in particular must stay publicly reachable for App
Store review).
