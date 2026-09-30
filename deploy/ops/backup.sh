#!/usr/bin/env bash
# Nightly backup of the only state on the VPS (NH-34): the volumes in
# notch-dev and notch-prod. That's each OpenShell gateway's own volume (its
# database of sandboxes and their encrypted provider credentials) and every
# user's sandbox workspace (Hermes' memories, skills and sessions). Everything
# else lives in Git (the cluster) or in Supabase (accounts, chat, facts).
#
#   sudo /usr/local/lib/notch-ops/backup.sh   (the notch-backup timer runs it at 01:30 UTC)
#
# One archive per run, encrypted to the age public keys in
# /etc/notch/backup-recipients.txt as it's written:
#   /var/backups/notch/notch-<UTC time>.tar.gz.age   the newest BACKUP_KEEP (7) kept
# With BACKUP_S3_* set in /etc/notch/ops.env, each archive is also uploaded to
# Nebius Object Storage, where a lifecycle rule on the bucket expires it.
# restore.sh puts an archive back on a new host.
#
# Nothing is stopped: SQLite databases are copied through SQLite's online
# backup, so they're consistent even while a gateway or a sandbox writes; the
# other files are copied as they are. At that hour most sandboxes are stopped
# anyway (idle after 10 minutes).
#
# Not in the archive, on purpose: the gateways' openshell-credential-kek and
# /etc/notch/*.env. The team keeps those off the VPS (deploy/README.md), so the
# archive alone can't decrypt the stored provider credentials.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/ops/lib.sh
. "$HERE/lib.sh"

require_root
require_commands kubectl jq sqlite3 age tar gzip flock
check_config_file
[[ -s $NOTCH_BACKUP_RECIPIENTS ]] || die "$NOTCH_BACKUP_RECIPIENTS is missing or empty — see deploy/README.md, Backups"

keep="$(config BACKUP_KEEP)"
keep="${keep:-7}"
[[ $keep =~ ^[1-9][0-9]*$ ]] || die "BACKUP_KEEP must be a positive number"

install -d -m 0700 "$NOTCH_BACKUP_DIR"
exec 9>"$NOTCH_BACKUP_DIR/.lock"
flock -n 9 || die "another backup is running"
# A run killed halfway leaves its plain copy behind; nothing else may use it.
find "$NOTCH_BACKUP_DIR" -maxdepth 1 -name '.work.*' -exec rm -rf {} +

name="notch-$(date -u +%Y%m%dT%H%M%SZ).tar.gz.age"
out="$NOTCH_BACKUP_DIR/$name"
[[ ! -e $out ]] || die "$out already exists"
work="$(mktemp -d "$NOTCH_BACKUP_DIR/.work.XXXXXX")"
trap 'rm -rf "$work" "$out.partial"' EXIT
mkdir -p "$work/meta" "$work/volumes"

# Copies SQLite database $1 to $2 through SQLite's online backup.
sqlite_backup() {
  local src="$1" dst="$2" uri s
  [[ $dst != *"'"* ]] || die "unexpected quote in $dst"
  uri="${src//%/%25}"
  uri="${uri//\?/%3f}"
  uri="${uri//#/%23}"
  sqlite3 -cmd ".timeout 10000" "file:$uri?mode=ro" ".backup '$dst'"
  # Opening a WAL database can create its -wal and -shm files, here as root;
  # give them to the database's owner, or the gateway or sandbox that owns it
  # couldn't open it any more.
  for s in -wal -shm; do
    if [[ -e $src$s ]]; then chown --reference="$src" "$src$s"; fi
  done
}

# Copies volume directory $1 to $2, then replaces every SQLite database in the
# copy with a consistent backup of the original. Prints each database's path,
# relative to the volume.
copy_volume() {
  local src="$1" dst="$2" f rel
  mkdir -p "$(dirname "$dst")"
  cp -a "$src" "$dst"
  while IFS= read -r -d '' f; do
    [[ $(head -c 15 "$f" | tr -d '\0') == "SQLite format 3" ]] || continue
    rel="${f#"$src"/}"
    rm -f "$dst/$rel" "$dst/$rel-wal" "$dst/$rel-shm" "$dst/$rel-journal"
    sqlite_backup "$f" "$dst/$rel"
    printf '%s\n' "$rel"
  done < <(find "$src" -type f -size +99c -print0)
}

# ------------------------------------------------------------------ volumes
# Every bound volume claimed in the two namespaces. Only volumes with a
# directory on this host are supported (k3s' local-path, the default).
namespaces="$(printf '%s\n' "${NOTCH_NAMESPACES[@]}" | jq -R . | jq -sc .)"
pvs="$(kubectl get pv -o json)"
selected="$(jq -c --argjson ns "$namespaces" '
  .items[]
  | select(.status.phase == "Bound" and .spec.claimRef != null and (.spec.claimRef.namespace | IN($ns[])))
  | {pv: .metadata.name, namespace: .spec.claimRef.namespace, pvc: .spec.claimRef.name,
     path: (.spec.hostPath.path // .spec.local.path // "")}' <<<"$pvs")"
volumes=()
if [[ -n $selected ]]; then mapfile -t volumes <<<"$selected"; fi

need=0
for v in "${volumes[@]}"; do
  path="$(jq -r .path <<<"$v")"
  [[ $path == /* && -d $path ]] \
    || die "volume $(jq -r '"\(.pv) (\(.namespace)/\(.pvc))"' <<<"$v") has no directory on this host — only local-path volumes are supported"
  need=$(( need + $(du -sb "$path" | cut -f1) ))
done
# The plain copy and the archive side by side, with room to spare.
avail="$(df --output=avail -B1 "$NOTCH_BACKUP_DIR" | tail -n1 | tr -d ' ')"
(( avail > 2 * need + 1073741824 )) \
  || die "not enough free space in $NOTCH_BACKUP_DIR: the volumes take $need bytes, a backup needs twice that plus 1 GiB"

log "backing up ${#volumes[@]} volume(s), $need bytes"
: > "$work/volumes.jsonl"
for v in "${volumes[@]}"; do
  pv="$(jq -r .pv <<<"$v")"
  ns="$(jq -r .namespace <<<"$v")"
  pvc="$(jq -r .pvc <<<"$v")"
  path="$(jq -r .path <<<"$v")"
  mkdir -p "$work/meta/$ns"
  kubectl get pv "$pv" -o json > "$work/meta/$ns/$pvc.pv.json"
  kubectl -n "$ns" get pvc "$pvc" -o json > "$work/meta/$ns/$pvc.pvc.json"
  dbs="$(copy_volume "$path" "$work/volumes/$ns/$pvc")"
  databases=()
  if [[ -n $dbs ]]; then mapfile -t databases <<<"$dbs"; fi
  bytes="$(du -sb "$work/volumes/$ns/$pvc" | cut -f1)"
  jq -c --argjson bytes "$bytes" '. + {bytes: $bytes, sqlite: $ARGS.positional}' --args "${databases[@]}" <<<"$v" >> "$work/volumes.jsonl"
  log "  $ns/$pvc: $bytes bytes, ${#databases[@]} SQLite database(s)"
done

# For the restore drill: what the sandboxes looked like. Absent before the
# Agent Sandbox CRDs exist.
kubectl get sandboxes.agents.x-k8s.io -A -o json > "$work/meta/sandboxes.json" 2>/dev/null || rm -f "$work/meta/sandboxes.json"

jq -n \
  --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg host "$(hostname)" \
  --arg k3s "$(k3s --version 2>/dev/null | head -n1 || true)" \
  --slurpfile volumes "$work/volumes.jsonl" \
  '{format: 1, created: $created, host: $host, k3s: $k3s, volumes: $volumes}' > "$work/MANIFEST.json"
rm "$work/volumes.jsonl"

# ------------------------------------------------------------------ archive
tar -C "$work" --numeric-owner -cf - MANIFEST.json meta volumes \
  | gzip -6 \
  | age -R "$NOTCH_BACKUP_RECIPIENTS" -o "$out.partial"
mv "$out.partial" "$out"
log "wrote $out ($(du -h "$out" | cut -f1))"

# The newest $keep stay; names sort by time.
mapfile -t old < <(find "$NOTCH_BACKUP_DIR" -maxdepth 1 -name 'notch-*.tar.gz.age' -printf '%f\n' | sort | head -n "-$keep")
for f in "${old[@]}"; do
  rm -f "${NOTCH_BACKUP_DIR:?}/$f"
  log "removed $f"
done

# ---------------------------------------------------- off-host copy (optional)
bucket="$(config BACKUP_S3_BUCKET)"
if [[ -n $bucket ]]; then
  endpoint="$(config BACKUP_S3_ENDPOINT)"
  region="$(config BACKUP_S3_REGION)"
  key_id="$(config BACKUP_S3_ACCESS_KEY_ID)"
  secret="$(config BACKUP_S3_SECRET_ACCESS_KEY)"
  [[ $endpoint =~ ^https://[a-z0-9.-]+$ && -n $region && -n $key_id && -n $secret ]] \
    || die "with BACKUP_S3_BUCKET set, BACKUP_S3_ENDPOINT (https://storage.<region>.nebius.cloud), BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY are required"
  [[ $bucket =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "BACKUP_S3_BUCKET isn't a valid bucket name"
  object="$(hostname -s)/$name"
  curl_config_line user "$key_id:$secret" > "$work/curl.conf"
  log "uploading to $endpoint/$bucket/$object"
  # Path-style URL, SigV4; the payload isn't hashed up front (the archive is
  # already encrypted, and TLS protects it in transit).
  if ! curl -sS --fail-with-body --retry 3 --retry-all-errors --max-time 1800 \
    -K "$work/curl.conf" --aws-sigv4 "aws:amz:$region:s3" \
    -H 'x-amz-content-sha256: UNSIGNED-PAYLOAD' \
    -T "$out" -o "$work/upload.out" "$endpoint/$bucket/$object"; then
    cat "$work/upload.out" >&2 2>/dev/null || true
    die "upload failed; the archive is still in $NOTCH_BACKUP_DIR"
  fi
  log "uploaded"
fi
