#!/usr/bin/env bash
# Puts the volumes from a backup.sh archive back on a freshly bootstrapped host:
# NH-34's restore drill and NH-96's move. It runs before Argo CD deploys the
# environment, so each gateway and each sandbox finds its volume already there,
# under the claim name it had, and nothing starts on an empty one:
#
#   sudo deploy/bootstrap/bootstrap.sh --no-root-app
#   sudo deploy/ops/install.sh
#   sudo deploy/ops/restore.sh <archive> <age identity file> prod
#   sudo deploy/bootstrap/secrets.sh prod /etc/notch/prod.env --restore-kek <kek file>
#   sudo kubectl apply -f deploy/bootstrap/root-app.yaml
#
# Environments: prod, dev or both. Refuses a namespace that already has volume
# claims and never writes over an existing directory, so a mistaken run can't
# damage a live host. The full procedure is in deploy/README.md.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/ops/lib.sh
. "$HERE/lib.sh"

usage() { die "usage: $0 <archive.tar.gz.age> <age identity file> prod|dev [prod|dev]"; }

require_root
require_commands kubectl jq age tar gzip
(( $# >= 3 )) || usage
archive="$1"
identity="$2"
shift 2
targets=()
for e in "$@"; do
  [[ $e == dev || $e == prod ]] || usage
  targets+=("notch-$e")
done
[[ -f $archive ]] || die "$archive not found"
[[ -f $identity ]] || die "$identity not found"

# ---------------------------------------------------------------- preflight
kubectl get nodes > /dev/null || die "k3s isn't running — run deploy/bootstrap/bootstrap.sh --no-root-app first"
nodes="$(kubectl get nodes -o json | jq -r '.items[].metadata.name')"
[[ -n $nodes && $nodes != *$'\n'* ]] || die "expected exactly one node, found: ${nodes//$'\n'/ }"
node="$nodes"

if kubectl -n argocd get application root > /dev/null 2>&1; then
  die "the root Application already exists, so Argo CD may be deploying onto empty volumes. Restore into a host bootstrapped with --no-root-app"
fi
for ns in "${targets[@]}"; do
  if [[ -n "$(kubectl -n "$ns" get pvc -o name 2> /dev/null)" ]]; then
    die "$ns already has volume claims — restore only into a fresh cluster"
  fi
done

work="$(mktemp -d "${TMPDIR:-/var/tmp}/notch-restore.XXXXXX")"
trap 'rm -rf "$work"' EXIT
log "decrypting $archive"
age -d -i "$identity" "$archive" | gzip -dc | tar -C "$work" --numeric-owner -xf -
[[ $(jq -r .format "$work/MANIFEST.json") == 1 ]] || die "unknown archive format"
log "archive from $(jq -r '.host + " at " + .created' "$work/MANIFEST.json")"

namespaces="$(printf '%s\n' "${targets[@]}" | jq -R . | jq -sc .)"
selected="$(jq -c --argjson ns "$namespaces" '.volumes[] | select(.namespace | IN($ns[]))' "$work/MANIFEST.json")"
[[ -n $selected ]] || die "the archive has no volumes for ${targets[*]}"
mapfile -t volumes <<<"$selected"

# Everything is checked before anything is written.
for v in "${volumes[@]}"; do
  ns="$(jq -r .namespace <<<"$v")"
  pvc="$(jq -r .pvc <<<"$v")"
  path="$(jq -r .path <<<"$v")"
  [[ $path == /* && $path != *..* ]] || die "unexpected path $path for $ns/$pvc"
  [[ -d $work/volumes/$ns/$pvc && -f $work/meta/$ns/$pvc.pv.json && -f $work/meta/$ns/$pvc.pvc.json ]] \
    || die "the archive is missing $ns/$pvc"
  if [[ -e $path || -L $path ]]; then
    [[ -d $path && ! -L $path && -z "$(ls -A "$path")" ]] || die "$path already exists and isn't empty"
  fi
done

# ---------------------------------------------------------------- restore
# The volume gets its old claim back, pre-bound: the PersistentVolume keeps its
# name and directory and moves to this node; the claim loses whatever tied it to
# the old cluster. Owner references go too — their owners don't exist here, and
# the garbage collector would delete an orphaned claim.
pv_filter='
  del(.metadata.uid, .metadata.resourceVersion, .metadata.creationTimestamp,
      .metadata.managedFields, .metadata.finalizers, .status,
      .spec.claimRef.uid, .spec.claimRef.resourceVersion)
  | if .spec.nodeAffinity.required.nodeSelectorTerms then
      .spec.nodeAffinity.required.nodeSelectorTerms |= map(
        .matchExpressions |= ((. // []) | map(if .key == "kubernetes.io/hostname" then .values = [$node] else . end)))
    else . end'
pvc_filter='
  del(.metadata.uid, .metadata.resourceVersion, .metadata.creationTimestamp,
      .metadata.managedFields, .metadata.finalizers, .metadata.ownerReferences, .status,
      .metadata.annotations["pv.kubernetes.io/bind-completed"],
      .metadata.annotations["pv.kubernetes.io/bound-by-controller"],
      .metadata.annotations["volume.kubernetes.io/selected-node"],
      .metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"])
  | .spec.volumeName = $pv'

for ns in "${targets[@]}"; do
  # Argo CD adopts the namespace when it syncs the environment.
  kubectl get namespace "$ns" > /dev/null 2>&1 || kubectl create namespace "$ns"
done

for v in "${volumes[@]}"; do
  pv="$(jq -r .pv <<<"$v")"
  ns="$(jq -r .namespace <<<"$v")"
  pvc="$(jq -r .pvc <<<"$v")"
  path="$(jq -r .path <<<"$v")"
  if [[ -d $path ]]; then rmdir "$path"; fi
  mkdir -p "$(dirname "$path")"
  cp -a "$work/volumes/$ns/$pvc" "$path"
  jq --arg node "$node" "$pv_filter" "$work/meta/$ns/$pvc.pv.json" | kubectl create -f - > /dev/null
  jq --arg pv "$pv" "$pvc_filter" "$work/meta/$ns/$pvc.pvc.json" | kubectl create -f - > /dev/null
  log "restored $ns/$pvc ($(jq -r .bytes <<<"$v") bytes) at $path"
done

for v in "${volumes[@]}"; do
  kubectl -n "$(jq -r .namespace <<<"$v")" wait --for=jsonpath='{.status.phase}'=Bound \
    "pvc/$(jq -r .pvc <<<"$v")" --timeout=120s > /dev/null
done
log "all ${#volumes[@]} claim(s) bound"

cat <<EOF

Next, before Argo CD starts anything:
  1. Each restored environment's secrets, with the credential key the backup
     was taken under (the gateway can't read its provider credentials without it):
       sudo deploy/bootstrap/secrets.sh <env> /etc/notch/<env>.env --restore-kek <kek file>
     /etc/notch/<env>.env must carry the old SANDBOX_KEY_SECRET, or the relay
     can't call the restored sandboxes.
  2. sudo kubectl apply -f deploy/bootstrap/root-app.yaml
  3. Check: argocd --core app list; a restored user's chat works end to end.
EOF
