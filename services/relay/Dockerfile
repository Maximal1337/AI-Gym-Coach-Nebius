# syntax=docker/dockerfile:1
# The relay image (NH-54, NH-37). Built by .github/workflows/images.yml for
# linux/amd64 from the repository root:
#   docker build -f services/relay/Dockerfile .
# Runs as the image's non-root `node` user with a read-only root filesystem
# (deploy/notch/base/relay.yaml); only /tmp and the OpenShell CLI's config
# directory are writable.
FROM node:22-slim

WORKDIR /app

# The OpenShell CLI the sandbox manager drives (NH-55): the static musl build,
# pinned to the gateway's release and checked against its published digest.
ARG OPENSHELL_VERSION=v0.1.2
ADD --checksum=sha256:7eb6917285331a09e3300266a0558616481a5e9927cae2612ea07c4045b6dd6f \
  https://github.com/NVIDIA/OpenShell/releases/download/${OPENSHELL_VERSION}/openshell-x86_64-unknown-linux-musl.tar.gz \
  /tmp/openshell.tar.gz
# Apache-2.0: the binary ships with its license and third-party notices.
ADD --checksum=sha256:c4be3acebe12527d7de689933d98329b4065f8c50cd929d0365584eafe6c20dd \
  https://raw.githubusercontent.com/NVIDIA/OpenShell/${OPENSHELL_VERSION}/LICENSE \
  /usr/share/doc/openshell/LICENSE
ADD --checksum=sha256:38553317c4658e42d36b5a59ec7a580a03efe830842eab84cefa2bf35234ac05 \
  https://raw.githubusercontent.com/NVIDIA/OpenShell/${OPENSHELL_VERSION}/THIRD-PARTY-NOTICES \
  /usr/share/doc/openshell/THIRD-PARTY-NOTICES
RUN tar -xzf /tmp/openshell.tar.gz -C /usr/local/bin openshell \
  && rm /tmp/openshell.tar.gz \
  && chmod 0755 /usr/local/bin/openshell \
  && chmod 0644 /usr/share/doc/openshell/* \
  && openshell --version

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
