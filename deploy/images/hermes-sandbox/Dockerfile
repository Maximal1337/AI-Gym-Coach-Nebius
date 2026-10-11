# The Hermes sandbox image (NH-21, D-25): NemoClaw's published Hermes sandbox
# image — Hermes with every NemoClaw patch for life inside OpenShell — plus the
# Notch coach profile and one patch of ours to Hermes' API server. Neither
# their start script nor their `hermes` wrapper is used; the relay starts each
# sandbox with /opt/notch/hermes-profile/start-hermes.sh
# (services/relay/src/main.ts). See README.md, "The image (NH-21)".
#
# Pinned by digest (v0.0.130, 2026-10-01; linux/amd64 and arm64). Move it on
# purpose, after reading what changed in NemoClaw's agents/hermes: the build
# stops if Hermes' key check no longer looks the way the patch expects.
FROM ghcr.io/nvidia/nemoclaw/hermes-sandbox:v0.0.130@sha256:962a2c907e6471efbc322ee3298620e55aa902406ae341704ec19b4b150ad7ad

USER root

# Outside /sandbox: the sandbox's own volume is mounted there and would hide
# it. install-profile.sh copies the profile into $HERMES_HOME on every start.
# The directories are made first, with their modes: COPY --chmod gives the
# directories it creates the files' mode, and a 0644 directory can't be entered
# (the sandbox user got "Permission denied" on the first image).
RUN install -d -m 0755 /opt/notch /opt/notch/hermes-profile /opt/notch/patches
COPY --chmod=0644 profile/SOUL.md profile/config.yaml /opt/notch/hermes-profile/
COPY --chmod=0755 profile/install-profile.sh profile/start-hermes.sh /opt/notch/hermes-profile/
COPY --chmod=0755 patch-hermes-api-key.py /opt/notch/patches/

# Hermes' API server also takes its key from X-Hermes-Api-Key: OpenShell's
# gateway strips Authorization on the way to a sandbox service. The script
# fails the build unless the patch applies and the patched check behaves.
RUN /opt/hermes/.venv/bin/python -I /opt/notch/patches/patch-hermes-api-key.py /opt/hermes/gateway/platforms/api_server.py

USER sandbox

# As the user every sandbox runs as: the profile is readable, the scripts run.
RUN test "$(stat -c '%a' /opt/notch /opt/notch/hermes-profile | tr '\n' ' ')" = "755 755 " \
 && test -r /opt/notch/hermes-profile/SOUL.md \
 && test -r /opt/notch/hermes-profile/config.yaml \
 && test -x /opt/notch/hermes-profile/install-profile.sh \
 && test -x /opt/notch/hermes-profile/start-hermes.sh \
 && grep -q 'X-Hermes-Api-Key' /opt/hermes/gateway/platforms/api_server.py
