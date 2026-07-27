FROM node:22-slim

WORKDIR /app

# Shared, world-writable cache so corepack's downloaded pnpm binary is
# reachable from any runtime user, not just the one that ran `pnpm install`
# during the build (default $HOME-scoped cache would force a re-download
# on every container boot once we drop to a non-root USER below).
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p /opt/corepack && chmod -R 755 /opt/corepack \
  && corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/agent/package.json services/agent/package.json

RUN pnpm install --frozen-lockfile --filter @gymcoach/agent...

COPY packages/shared packages/shared
COPY services/agent services/agent

WORKDIR /app/services/agent

ENV PORT=8787
EXPOSE 8787
USER node
CMD ["pnpm", "start"]
