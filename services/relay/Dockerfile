# The relay image (NH-54, NH-37). Built by .github/workflows/images.yml for
# linux/amd64 from the repository root:
#   docker build -f services/relay/Dockerfile .
# Runs as the image's non-root `node` user with a read-only root filesystem
# (deploy/notch/base/relay.yaml); only /tmp is writable.
FROM node:22-slim

WORKDIR /app

ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p /opt/corepack && corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY services/relay/package.json services/relay/package.json
RUN pnpm install --frozen-lockfile --filter @gymcoach/relay...

COPY services/relay services/relay

WORKDIR /app/services/relay
ENV NODE_ENV=production
USER node
# tsx runs the TypeScript sources directly (imports use .js specifiers, which
# Node's own type stripping doesn't map to .ts). No pnpm or corepack at run time.
CMD ["node", "--import", "tsx", "src/main.ts"]
