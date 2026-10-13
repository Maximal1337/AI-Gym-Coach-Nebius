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

# Python's CA bundle in this image is a chain of two links: certifi's
# cacert.pem to /etc/openshell-tls/ca-bundle.pem (NemoClaw's), and that to
# where OpenShell's Kubernetes supervisor puts the sandbox's bundle (ours, in
# the Dockerfile). If the chain ends nowhere Hermes starts and then answers
# every turn with a 500, so it's checked here, where a failed start is seen.
ca="${NOTCH_CA_BUNDLE:-/etc/openshell-tls/ca-bundle.pem}"
[ -s "$ca" ] || { echo "start-hermes: no CA bundle at $ca (SSL_CERT_FILE=${SSL_CERT_FILE:-unset}): has OpenShell moved the sandbox's bundle?" >&2; exit 1; }

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
