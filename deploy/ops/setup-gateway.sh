#!/usr/bin/env bash
# Sets an environment's OpenShell gateway up from Git (NH-33), the runbook's
# steps 1 to 3 in deploy/README.md: the global sandbox policy, the provider
# profiles, and a check of the shared providers. A new or restored gateway
# needs this one command; a second run changes nothing.
#
#   deploy/ops/setup-gateway.sh <dev|prod> <project-ref>.supabase.co [--check]
#
# Runs on the VPS, through the environment's relay pod, whose openshell CLI is
# registered with the gateway. The two placeholders of the files in
# deploy/platform/openshell are filled in: @SUPABASE_HOST@ from the argument
# (in the password manager's Notch VPS entry), @HERMES_BINARY@ from
# HERMES_BINARY (/usr/bin/python3.13, the pinned image's interpreter).
#
# The policy is set and a profile imported or updated only when the gateway's
# copy differs from Git, so a run on a gateway with live sandboxes reloads
# nothing it doesn't have to. Providers are only checked: their keys are typed
# at a hidden prompt (the runbook's step 3), never handled here.
#
# --check reports what would change and changes nothing.
# Exit status: 0 all in place, 2 done but a provider is missing, 1 an error.
# Needs kubectl, python3 with PyYAML (Ubuntu's python3-yaml) and GNU tar.
set -euo pipefail
shopt -s inherit_errexit

usage() {
  echo "usage: $0 <dev|prod> <project-ref>.supabase.co [--check]" >&2
  exit 1
}
env="${1:-}"
host="${2:-}"
mode="${3:-apply}"
[[ $env == dev || $env == prod ]] || usage
[[ $host =~ ^[a-z0-9]+\.supabase\.co$ ]] || usage
[[ $mode == apply || $mode == --check ]] || usage

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${SETUP_GATEWAY_SRC:-$REPO/deploy/platform/openshell}"
HERMES_BINARY="${HERMES_BINARY:-/usr/bin/python3.13}"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"
ns="notch-$env"
POD_DIR=/tmp/openshell-setup

pod() { kubectl -n "$ns" exec -i deploy/notch-relay -c relay -- "$@"; }
openshell() { pod env NO_COLOR=1 OPENSHELL_GATEWAY=notch openshell "$@"; }
yamlcmp() { python3 "$REPO/deploy/ops/gateway-yaml.py" "$@"; }
say() { printf '%s: %s\n' "$env" "$*"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fill() { sed -e "s|@SUPABASE_HOST@|$host|g" -e "s|@HERMES_BINARY@|$HERMES_BINARY|g" "$1"; }
fill "$SRC/sandbox-policy.yaml" > "$work/sandbox-policy.yaml"
for f in "$SRC"/profiles/*.yaml; do
  id="$(fill "$f" | yamlcmp id /dev/stdin)"
  mkdir -p "$work/import/$id"
  fill "$f" > "$work/import/$id/$(basename "$f")"
done
if left="$(grep -l '@[A-Z_]*@' -r "$work")"; then
  echo "placeholders left in: $left" >&2
  exit 1
fi
# The filled-in files go to the relay's pod, where its CLI reads them.
if [[ $mode == apply ]]; then
  tar -C "$work" -cf - . | pod sh -c "rm -rf $POD_DIR && mkdir $POD_DIR && tar -C $POD_DIR -xf -"
fi

# 1. The global policy.
if openshell policy get --global --full 2> /dev/null | yamlcmp policy "$work/sandbox-policy.yaml"; then
  say "policy: as in Git"
elif [[ $mode == --check ]]; then
  say "policy: differs from Git — would be set"
else
  openshell policy set --global --policy "$POD_DIR/sandbox-policy.yaml" --yes > /dev/null
  say "policy: set"
fi

# 2. The provider profiles, in the relay's workspace.
for dir in "$work"/import/*/; do
  id="$(basename "$dir")"
  file="$(ls "$dir")"
  if ! exported="$(openshell profile export "$id" 2> /dev/null)"; then
    if [[ $mode == --check ]]; then
      say "profile $id: missing — would be imported"
    else
      openshell profile lint --from "$POD_DIR/import/$id" > /dev/null
      openshell profile import --from "$POD_DIR/import/$id" > /dev/null
      say "profile $id: imported"
    fi
  elif yamlcmp profile "$dir/$file" <<< "$exported"; then
    say "profile $id: as in Git"
  elif [[ $mode == --check ]]; then
    say "profile $id: differs from Git — would be updated"
  else
    # An update names the version it replaces (the runbook's step 2).
    version="$(yamlcmp version <<< "$exported")"
    { echo "resource_version: $version"; grep -v '^resource_version:' "$dir/$file"; } |
      pod sh -c "cat > $POD_DIR/update-$id.yaml"
    openshell profile update --file "$POD_DIR/update-$id.yaml" "$id" > /dev/null
    say "profile $id: updated from version $version"
  fi
done

# 3. The shared providers every sandbox gets (SANDBOX_SHARED_PROVIDERS): checked only.
providers="$(openshell provider list 2> /dev/null || true)"
missing=0
for name in token-factory tavily; do
  keys="$(awk -v n="$name" '$1 == n { print $3 }' <<< "$providers")"
  if [[ -z $keys ]]; then
    say "provider $name: missing — create it with the runbook's step 3, the key at a hidden prompt"
    missing=1
  elif [[ $keys == 0 ]]; then
    say "provider $name: no credential — set it with the runbook's step 3"
    missing=1
  else
    say "provider $name: present"
  fi
done
exit $((missing * 2))
