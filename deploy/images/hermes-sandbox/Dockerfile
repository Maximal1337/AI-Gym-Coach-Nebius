# The Hermes sandbox image (NH-21, D-25): NemoClaw's published Hermes sandbox
# image — Hermes with every NemoClaw patch for life inside OpenShell — plus the
# Notch coach profile, two patches of ours to Hermes, and one link for the CA
# bundle. Neither their start script nor their `hermes` wrapper is used; the
# relay starts each sandbox with /opt/notch/hermes-profile/start-hermes.sh
# (services/relay/src/main.ts). See README.md, "The image (NH-21)".
#
# Pinned by digest (v0.0.130, 2026-10-01; linux/amd64 and arm64). Move it on
# purpose, after reading what changed in NemoClaw's agents/hermes: the build
# stops if the code the patches change, the CA bundle's link or the Python
# interpreter no longer look the way this file expects.
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
COPY --chmod=0755 patch-hermes-api-key.py patch-hermes-drain-gate.py patch-hermes-prompt.py /opt/notch/patches/

# Hermes' API server also takes its key from X-Hermes-Api-Key: OpenShell's
# gateway strips Authorization on the way to a sandbox service. The script
# fails the build unless the patch applies and the patched check behaves.
RUN /opt/hermes/.venv/bin/python -I /opt/notch/patches/patch-hermes-api-key.py /opt/hermes/gateway/platforms/api_server.py

# NemoClaw's cron-restore drain gate is off: it holds every turn (503) unless
# /sandbox/.nemoclaw is root's, which it can't be on a Kubernetes volume. Fails
# the build the same way.
RUN /opt/hermes/.venv/bin/python -I /opt/notch/patches/patch-hermes-drain-gate.py /opt/hermes/gateway/drain_control.py

# What reaches the model's prompt (NH-45): no tool result can carry Hermes'
# out-of-band user-message marker, the note that tells the model to trust it is
# gone (the relay never steers a turn), and the memory guidance no longer files
# the user's preferences into skills. Fails the build the same way, and imports
# the patched modules once more as Hermes would.
RUN /opt/hermes/.venv/bin/python -I /opt/notch/patches/patch-hermes-prompt.py /opt/hermes

# Python's CA bundle. NemoClaw's image makes certifi's cacert.pem a link to
# /etc/openshell-tls/ca-bundle.pem, where another OpenShell driver mounts the
# sandbox's bundle. The Kubernetes driver's supervisor puts it under /run, so
# the link ended nowhere and Hermes answered every turn with a 500. ln fails,
# and the build with it, if a base image starts shipping that path itself.
RUN install -d -m 0755 /etc/openshell-tls \
 && ln -s /run/openshell-supervisor-ca/material/ca-bundle.crt /etc/openshell-tls/ca-bundle.pem

USER sandbox

# As the user every sandbox runs as: the profile is readable, the scripts run,
# the three patches are in, certifi still points where the link above continues, and
# Hermes' interpreter is still the binary the provider profiles and the sandbox
# policy name (@HERMES_BINARY@, deploy/README.md) — under another one OpenShell
# would refuse every request Hermes makes.
RUN test "$(stat -c '%a' /opt/notch /opt/notch/hermes-profile | tr '\n' ' ')" = "755 755 " \
 && test -r /opt/notch/hermes-profile/SOUL.md \
 && test -r /opt/notch/hermes-profile/config.yaml \
 && test -x /opt/notch/hermes-profile/install-profile.sh \
 && test -x /opt/notch/hermes-profile/start-hermes.sh \
 && grep -q 'X-Hermes-Api-Key' /opt/hermes/gateway/platforms/api_server.py \
 && grep -q 'patch-hermes-drain-gate.py' /opt/hermes/gateway/drain_control.py \
 && grep -q 'patch-hermes-prompt.py' /opt/hermes/agent/tool_dispatch_helpers.py \
 && grep -q 'patch-hermes-prompt.py' /opt/hermes/agent/system_prompt.py \
 && grep -q 'patch-hermes-prompt.py' /opt/hermes/agent/prompt_builder.py \
 && test "$(readlink "$(/opt/hermes/.venv/bin/python -I -c 'import certifi; print(certifi.where())')")" = /etc/openshell-tls/ca-bundle.pem \
 && test "$(readlink /etc/openshell-tls/ca-bundle.pem)" = /run/openshell-supervisor-ca/material/ca-bundle.crt \
 && test "$(readlink -f /opt/hermes/.venv/bin/python)" = /usr/bin/python3.13
