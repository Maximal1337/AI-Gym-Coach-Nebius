# Shared by the ops scripts in this directory (NH-34, NH-35). Sourced, never run.
# shellcheck shell=bash

# `set -e` also inside $(...): the scripts collect results from functions that
# must stop on the first error.
shopt -s inherit_errexit

export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

# Used by the scripts that source this file.
# shellcheck disable=SC2034
{
  # Paths, overridable only so the tests (test/ops.test.sh) can run unprivileged.
  NOTCH_OPS_CONFIG="${NOTCH_OPS_CONFIG:-/etc/notch/ops.env}"
  NOTCH_BACKUP_DIR="${NOTCH_BACKUP_DIR:-/var/backups/notch}"
  NOTCH_BACKUP_RECIPIENTS="${NOTCH_BACKUP_RECIPIENTS:-/etc/notch/backup-recipients.txt}"

  # The namespaces whose volumes are Notch's state: each holds one
  # environment's OpenShell gateway and its users' sandboxes.
  NOTCH_NAMESPACES=(notch-dev notch-prod)
}

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

require_root() {
  [[ $EUID -eq 0 || ${NOTCH_OPS_ALLOW_NONROOT:-0} == 1 ]] || die "run as root (sudo)"
}

require_commands() {
  local missing=()
  for c in "$@"; do command -v "$c" >/dev/null || missing+=("$c"); done
  (( ${#missing[@]} == 0 )) || die "missing: ${missing[*]} — run deploy/ops/install.sh (it installs them)"
}

# The value of KEY in the ops env file: the first KEY= line, everything after
# '='. Parsed, never sourced; a missing file or key reads as empty. Same rules
# as deploy/bootstrap/secrets.sh.
config() {
  [[ -f $NOTCH_OPS_CONFIG ]] || return 0
  grep -m1 -E "^$1=" "$NOTCH_OPS_CONFIG" | cut -d= -f2- | tr -d '\r' || true
}

# Refuses an ops env file other users could read: it holds the bucket's keys
# and the health check URL.
check_config_file() {
  [[ -f $NOTCH_OPS_CONFIG ]] || return 0
  [[ ${NOTCH_OPS_ALLOW_NONROOT:-0} == 1 ]] && return 0
  [[ $(stat -c '%U' "$NOTCH_OPS_CONFIG") == root ]] || die "$NOTCH_OPS_CONFIG must be owned by root"
  [[ $(stat -c '%a' "$NOTCH_OPS_CONFIG") =~ ^[46]00$ ]] || die "$NOTCH_OPS_CONFIG must be mode 600 (chmod 600 $NOTCH_OPS_CONFIG)"
}

# Writes a curl config line with a quoted value, so secrets stay off the
# command line (ps shows arguments to every user).
curl_config_line() {
  local v="${2//\\/\\\\}"
  printf '%s = "%s"\n' "$1" "${v//\"/\\\"}"
}
