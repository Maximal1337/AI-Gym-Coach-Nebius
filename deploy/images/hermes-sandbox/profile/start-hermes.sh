#!/bin/sh
# Starts Hermes in a Notch sandbox: the command the relay gives every sandbox
# (services/relay/src/main.ts, NH-21).
#
# It runs Hermes itself, `hermes.real`, not NemoClaw's `hermes` wrapper. Before
# `hermes gateway` the wrapper checks that /sandbox has one of a fixed list of
# owners, groups and modes, and on a Kubernetes workspace volume /sandbox is
# root:sandbox 2777 — kubelet's fsGroup always adds the setgid bit — so it
# refuses every time ("does not match a trusted owner/group/mode posture").
#
# What the wrapper and NemoClaw's start script set up for the gateway is done
# here instead:
#   - never as root;
#   - HOME=/sandbox;
#   - HERMES_SKIP_CHMOD=1: Hermes leaves the modes of its home alone;
#   - HERMES_LAZY_INSTALL_TARGET: optional Python packages come from, and go
#     to, the sandbox's own volume, not the read-only image.
# NemoClaw starts the gateway with umask 0007, for its two accounts; here one
# user owns everything, so 077.
#
# Left out on purpose: the wrapper's check that no raw secret sits in the
# environment or in .env. A sandbox gets its credentials as OpenShell
# placeholders (D-28), and NH-26's probe checks the environment from inside.
# The wrapper's argument translation doesn't touch `gateway run`.
set -eu

[ "$(id -u)" -ne 0 ] || { echo "start-hermes: refusing to run Hermes as root" >&2; exit 1; }
: "${HERMES_HOME:?HERMES_HOME must be set}"

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
umask 077
export HOME=/sandbox
export HERMES_SKIP_CHMOD=1
export HERMES_LAZY_INSTALL_TARGET="$HERMES_HOME/lazy-packages"

sh "$here/install-profile.sh"
# Hermes reads the key from $HERMES_HOME/.env, where install-profile.sh just
# put it; its own environment doesn't keep a copy.
unset API_SERVER_KEY
exec hermes.real gateway run
