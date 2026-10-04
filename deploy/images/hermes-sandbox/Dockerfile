# The Hermes sandbox image (NH-21, D-25): NemoClaw's published Hermes sandbox
# image — Hermes with every NemoClaw patch for life inside OpenShell, and their
# `hermes` wrapper that guards the environment — plus the Notch coach profile.
# Their start script isn't used; the relay starts each sandbox with
#   /opt/notch/hermes-profile/install-profile.sh && exec env -u API_SERVER_KEY hermes gateway run
# (services/relay/src/main.ts). See README.md, "The image (NH-21)".
#
# Pinned by digest (v0.0.130, 2026-10-01; linux/amd64 and arm64). Move it on
# purpose, after reading what changed in NemoClaw's agents/hermes, and check
# their secret boundary still accepts install-profile.sh's .env.
FROM ghcr.io/nvidia/nemoclaw/hermes-sandbox:v0.0.130@sha256:962a2c907e6471efbc322ee3298620e55aa902406ae341704ec19b4b150ad7ad

# Outside /sandbox: the sandbox's own volume is mounted there and would hide
# it. install-profile.sh copies the profile into $HERMES_HOME on every start.
COPY --chmod=0644 profile/SOUL.md profile/config.yaml /opt/notch/hermes-profile/
COPY --chmod=0755 profile/install-profile.sh /opt/notch/hermes-profile/
