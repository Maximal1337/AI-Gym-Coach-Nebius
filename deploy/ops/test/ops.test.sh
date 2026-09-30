#!/usr/bin/env bash
# Runs backup.sh, restore.sh and health.sh (NH-34, NH-35) on real files with
# a fake kubectl, systemctl, k3s and curl: a SQLite database in WAL mode with a
# writer holding it open, age encryption, the objects the restore creates, the
# health report and its two-runs rule. Linux with GNU tools; needs jq, sqlite3
# and age. CI runs it in .github/workflows/ops.yml.
#
#   bash deploy/ops/test/ops.test.sh
set -euo pipefail
shopt -s inherit_errexit
OPS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
writer=""
cleanup() {
  if [[ -n $writer ]]; then kill "$writer" 2> /dev/null || true; fi
  rm -rf "$T"
}
trap cleanup EXIT

failures=0
logs=0
check() {
  local name="$1"
  shift
  if "$@"; then printf 'ok   %s\n' "$name"; else printf 'FAIL %s\n' "$name"; failures=$((failures + 1)); fi
}
eq() { [[ $1 == "$2" ]] || { printf '     expected %q\n     got      %q\n' "$2" "$1"; return 1; }; }
has() { grep -qF -- "$2" <<<"$1" || { printf '     missing %q in:\n%s\n' "$2" "$1"; return 1; }; }
# Runs a command with its output in a log, shown only if it fails.
quiet() {
  local log="$T/log.$((++logs))"
  if "$@" > "$log" 2>&1; then return 0; fi
  sed 's/^/     | /' "$log"
  return 1
}
fails_with() {
  local expected="$1" log="$T/log.$((++logs))"
  shift
  if "$@" > "$log" 2>&1; then printf '     succeeded, expected a failure\n'; return 1; fi
  grep -qF -- "$expected" "$log" || { printf '     failed without %q:\n' "$expected"; sed 's/^/     | /' "$log"; return 1; }
}

# ------------------------------------------------------------------ fakes
K="$T/k8s"
mkdir -p "$T/bin" "$K/created" "$T/proc" "$T/tmp" "$T/pings"
export FAKE_K8S="$K" FAKE_PINGS="$T/pings"

cat > "$T/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
K="$FAKE_K8S"
ns=""
if [[ ${1:-} == -n ]]; then ns="$2"; shift 2; fi
if [[ -f $K/api-down && $1 == get ]]; then echo "connection refused" >&2; exit 1; fi
case "$*" in
  "get pv -o json") cat "$K/pv.json" ;;
  "get pv "*" -o json") cat "$K/pv-$3.json" ;;
  "get pvc "*" -o json") cat "$K/pvc-$ns-$3.json" ;;
  "get pvc -o name") cat "$K/existing-pvc-$ns" 2> /dev/null || true ;;
  "get sandboxes.agents.x-k8s.io -A -o json") echo "no such resource" >&2; exit 1 ;;
  "get nodes") echo "NAME STATUS" ;;
  "get nodes -o json") cat "$K/nodes.json" ;;
  "get application root") [[ -f $K/root-app ]] ;;
  "get namespace "*) [[ -f $K/ns-$3 ]] ;;
  "create namespace "*) touch "$K/ns-$3" ;;
  "create -f -") cat > "$K/created/$(printf %02d "$(find "$K/created" -name '*.json' | wc -l)").json" ;;
  "wait "*) ;;
  "get deployments,statefulsets -A -o json") cat "$K/workloads.json" ;;
  "get applications.argoproj.io -o json") cat "$K/apps.json" ;;
  "get pods -A -o json") cat "$K/pods.json" ;;
  "get deployment notch-relay") [[ -f $K/relay-$ns.log ]] ;;
  "logs deployment/notch-relay --since=10m") cat "$K/relay-$ns.log" ;;
  *) echo "fake kubectl: unexpected: ${ns:+-n $ns }$*" >&2; exit 2 ;;
esac
EOF

cat > "$T/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "is-active --quiet k3s") exit 0 ;;
  "is-enabled --quiet notch-backup.timer") [[ -f $FAKE_K8S/backup-timer ]] ;;
  "is-failed --quiet notch-backup.service") [[ -f $FAKE_K8S/backup-failed ]] ;;
  *) echo "fake systemctl: unexpected: $*" >&2; exit 2 ;;
esac
EOF

cat > "$T/bin/k3s" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "--version") echo "k3s version v1.36.4+k3s1 (test)" ;;
  "crictl stats -o json") cat "$FAKE_K8S/stats.json" ;;
  *) echo "fake k3s: unexpected: $*" >&2; exit 2 ;;
esac
EOF

# Records what would be sent: the config file (the URL) and the body.
cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
n="$(find "$FAKE_PINGS" -name '*.conf' | wc -l)"
while (( $# )); do
  case "$1" in
    -K) cp "$2" "$FAKE_PINGS/$n.conf"; shift ;;
    --data-binary) cp "${2#@}" "$FAKE_PINGS/$n.body"; shift ;;
  esac
  shift
done
EOF
chmod +x "$T"/bin/*
export PATH="$T/bin:$PATH"

export NOTCH_OPS_ALLOW_NONROOT=1 NOTCH_OPS_CONFIG="$T/ops.env" NOTCH_BACKUP_DIR="$T/backups" \
  NOTCH_BACKUP_RECIPIENTS="$T/recipients" NOTCH_PROC="$T/proc" NOTCH_STATE_DIR="$T/state" \
  TMPDIR="$T/tmp" KUBECONFIG=/dev/null
cat > "$NOTCH_OPS_CONFIG" <<'EOF'
BACKUP_KEEP=2
HEALTH_DISK_MAX_PCT=100
HEALTH_MEM_MIN_PCT=5
HEALTHCHECK_URL=https://hc.example/check-1
EOF
age-keygen -o "$T/identity" 2> /dev/null
age-keygen -y "$T/identity" > "$T/recipients"

# ---------------------------------------------------------------- volumes
S="$T/storage"
sb="$S/pvc-0001_notch-prod_workspace-sb1"
gw="$S/pvc-0002_notch-prod_openshell-data-openshell-0"
dv="$S/pvc-0003_notch-dev_openshell-data-openshell-0"
ks="$S/pvc-0004_kube-system_other"
gone="$S/pvc-0005_notch-prod_workspace-gone"
mkdir -p "$sb/.hermes/memories" "$gw" "$dv" "$ks" "$gone"
printf 'likes morning workouts\n' > "$sb/.hermes/memories/MEMORY.md"
sqlite3 "$gw/openshell.db" "create table sandboxes(name text); insert into sandboxes values ('notch-prod-abc');"
sqlite3 "$dv/openshell.db" "create table sandboxes(name text);"
echo other > "$ks/file"
echo released > "$gone/file"

# A writer that keeps state.db open in WAL mode, so the rows sit in the -wal
# file and a plain copy of state.db alone would miss them.
mkfifo "$T/writer.fifo"
sqlite3 "$sb/.hermes/state.db" < "$T/writer.fifo" > /dev/null &
writer=$!
exec 7> "$T/writer.fifo"
printf '%s\n' "PRAGMA journal_mode=WAL;" "create table t(x);" "insert into t values (1), (2), (3);" >&7
rows() { sqlite3 "$1" 'select count(*) from t' 2> /dev/null || echo none; }
wait_rows() { for _ in $(seq 1 100); do [[ $(rows "$1") == "$2" ]] && return 0; sleep 0.1; done; return 1; }
wait_rows "$sb/.hermes/state.db" 3

pv() {
  jq -n --arg name "$1" --arg ns "$2" --arg pvc "$3" --arg path "$4" --arg phase "$5" '{
    apiVersion: "v1", kind: "PersistentVolume",
    metadata: {name: $name, uid: "uid-\($name)", resourceVersion: "42", creationTimestamp: "2026-10-01T00:00:00Z",
               annotations: {"pv.kubernetes.io/provisioned-by": "rancher.io/local-path"},
               finalizers: ["kubernetes.io/pv-protection"]},
    spec: {storageClassName: "local-path", capacity: {storage: "1Gi"}, accessModes: ["ReadWriteOnce"],
           persistentVolumeReclaimPolicy: "Delete", hostPath: {path: $path, type: "DirectoryOrCreate"},
           claimRef: {apiVersion: "v1", kind: "PersistentVolumeClaim", namespace: $ns, name: $pvc,
                      uid: "uid-claim-\($pvc)", resourceVersion: "41"},
           nodeAffinity: {required: {nodeSelectorTerms: [{matchExpressions: [
             {key: "kubernetes.io/hostname", operator: "In", values: ["old-node"]}]}]}}},
    status: {phase: $phase}}'
}
pvc() {
  jq -n --arg ns "$1" --arg name "$2" --arg pv "$3" '{
    apiVersion: "v1", kind: "PersistentVolumeClaim",
    metadata: {namespace: $ns, name: $name, uid: "uid-claim-\($name)", resourceVersion: "41",
               creationTimestamp: "2026-10-01T00:00:00Z", labels: {"agents.x-k8s.io/sandbox": "sb1"},
               annotations: {"pv.kubernetes.io/bind-completed": "yes", "pv.kubernetes.io/bound-by-controller": "yes",
                             "volume.kubernetes.io/selected-node": "old-node",
                             "volume.kubernetes.io/storage-provisioner": "rancher.io/local-path"},
               ownerReferences: [{apiVersion: "agents.x-k8s.io/v1beta1", kind: "Sandbox", name: "sb1", uid: "uid-sandbox"}],
               finalizers: ["kubernetes.io/pvc-protection"]},
    spec: {storageClassName: "local-path", accessModes: ["ReadWriteOnce"],
           resources: {requests: {storage: "1Gi"}}, volumeName: $pv},
    status: {phase: "Bound"}}'
}
pv pv-sb notch-prod workspace-sb1 "$sb" Bound > "$K/pv-pv-sb.json"
pv pv-gw notch-prod openshell-data-openshell-0 "$gw" Bound > "$K/pv-pv-gw.json"
pv pv-dev notch-dev openshell-data-openshell-0 "$dv" Bound > "$K/pv-pv-dev.json"
pv pv-ks kube-system other "$ks" Bound > "$K/pv-pv-ks.json"
pv pv-gone notch-prod workspace-gone "$gone" Released > "$K/pv-pv-gone.json"
jq -s '{apiVersion: "v1", kind: "List", items: .}' "$K"/pv-pv-*.json > "$K/pv.json"
pvc notch-prod workspace-sb1 pv-sb > "$K/pvc-notch-prod-workspace-sb1.json"
pvc notch-prod openshell-data-openshell-0 pv-gw > "$K/pvc-notch-prod-openshell-data-openshell-0.json"
pvc notch-dev openshell-data-openshell-0 pv-dev > "$K/pvc-notch-dev-openshell-data-openshell-0.json"

# ------------------------------------------------------------------ backup
echo "== backup"
archives() { find "$NOTCH_BACKUP_DIR" -maxdepth 1 -name 'notch-*.tar.gz.age' | sort; }
check "backup runs" quiet bash "$OPS/backup.sh"
first="$(archives | head -n1)"
check "one encrypted archive" eq "$(head -c 21 "$first")" "age-encryption.org/v1"
mkdir "$T/out"
age -d -i "$T/identity" "$first" | gzip -dc | tar -C "$T/out" -xf -
M="$T/out/MANIFEST.json"
check "only bound volumes of notch-dev and notch-prod" \
  eq "$(jq -r '[.volumes[] | .namespace + "/" + .pvc] | sort | join(" ")' "$M")" \
  "notch-dev/openshell-data-openshell-0 notch-prod/openshell-data-openshell-0 notch-prod/workspace-sb1"
check "WAL database copied whole while its writer holds it open" \
  eq "$(rows "$T/out/volumes/notch-prod/workspace-sb1/.hermes/state.db")" 3
check "no -wal or -shm files in the archive" eq "$(find "$T/out" \( -name '*-wal' -o -name '*-shm' \) | wc -l)" 0
check "gateway database copied" \
  eq "$(sqlite3 "$T/out/volumes/notch-prod/openshell-data-openshell-0/openshell.db" 'select name from sandboxes')" notch-prod-abc
check "plain files copied" eq "$(cat "$T/out/volumes/notch-prod/workspace-sb1/.hermes/memories/MEMORY.md")" "likes morning workouts"
check "databases listed in the manifest" \
  eq "$(jq -r '.volumes[] | select(.pvc == "workspace-sb1") | .sqlite | join(",")' "$M")" ".hermes/state.db"
check "claim saved for the restore" test -f "$T/out/meta/notch-prod/workspace-sb1.pvc.json"
check "volume saved for the restore" test -f "$T/out/meta/notch-prod/workspace-sb1.pv.json"

printf '%s\n' "insert into t values (4);" >&7
check "the live database still takes writes afterwards" wait_rows "$sb/.hermes/state.db" 4

sleep 1
check "second backup" quiet bash "$OPS/backup.sh"
sleep 1
check "third backup" quiet bash "$OPS/backup.sh"
check "keeps the newest BACKUP_KEEP archives" eq "$(archives | wc -l | tr -d ' ')" 2
check "the oldest one is gone" test ! -e "$first"
check "refuses without recipients" fails_with "backup-recipients" \
  env NOTCH_BACKUP_RECIPIENTS="$T/none/backup-recipients.txt" bash "$OPS/backup.sh"

exec 7>&-
wait "$writer" || true
writer=""

# ----------------------------------------------------------------- restore
echo "== restore"
latest="$(archives | tail -n1)"
mv "$S" "$T/old-storage"
jq -n '{items: [{metadata: {name: "new-node"}, status: {conditions: [{type: "Ready", status: "True"}]}}]}' > "$K/nodes.json"

check "restores prod" quiet bash "$OPS/restore.sh" "$latest" "$T/identity" prod
check "sandbox volume back, with the rows from the WAL" eq "$(rows "$sb/.hermes/state.db")" 4
check "sandbox files back" eq "$(cat "$sb/.hermes/memories/MEMORY.md")" "likes morning workouts"
check "gateway volume back" eq "$(sqlite3 "$gw/openshell.db" 'select name from sandboxes')" notch-prod-abc
check "dev left alone" test ! -e "$dv"
check "namespace created" test -f "$K/ns-notch-prod"
check "two volumes and two claims created" \
  eq "$(jq -rs 'map(.kind) | sort | join(",")' "$K"/created/*.json)" \
  "PersistentVolume,PersistentVolume,PersistentVolumeClaim,PersistentVolumeClaim"
created_pv="$(jq -s '.[] | select(.kind == "PersistentVolume" and .metadata.name == "pv-sb")' "$K"/created/*.json)"
created_pvc="$(jq -s '.[] | select(.kind == "PersistentVolumeClaim" and .metadata.name == "workspace-sb1")' "$K"/created/*.json)"
check "volume keeps its directory" eq "$(jq -r .spec.hostPath.path <<<"$created_pv")" "$sb"
check "volume moves to the new node" \
  eq "$(jq -r '.spec.nodeAffinity.required.nodeSelectorTerms[0].matchExpressions[0].values | join(",")' <<<"$created_pv")" new-node
check "volume pre-bound to its claim, nothing left from the old cluster" \
  eq "$(jq -c '[.spec.claimRef.namespace, .spec.claimRef.name, .spec.claimRef.uid, .metadata.uid, .metadata.resourceVersion, .status]' <<<"$created_pv")" \
  '["notch-prod","workspace-sb1",null,null,null,null]'
check "claim pinned to its volume, labels kept" \
  eq "$(jq -c '[.spec.volumeName, .metadata.labels["agents.x-k8s.io/sandbox"]]' <<<"$created_pvc")" '["pv-sb","sb1"]'
check "claim without owners, binding annotations or old identity" \
  eq "$(jq -c '[.metadata.ownerReferences, .metadata.uid, .metadata.annotations["pv.kubernetes.io/bind-completed"], .metadata.annotations["volume.kubernetes.io/selected-node"], .status]' <<<"$created_pvc")" \
  '[null,null,null,null,null]'

check "refuses to write over a restored directory" fails_with "isn't empty" \
  bash "$OPS/restore.sh" "$latest" "$T/identity" prod
echo "persistentvolumeclaim/something" > "$K/existing-pvc-notch-dev"
check "refuses a namespace that has claims" fails_with "already has volume claims" \
  bash "$OPS/restore.sh" "$latest" "$T/identity" dev
rm "$K/existing-pvc-notch-dev"
touch "$K/root-app"
check "refuses once the root Application exists" fails_with "root Application" \
  bash "$OPS/restore.sh" "$latest" "$T/identity" dev
rm "$K/root-app"
check "restores dev on its own" quiet bash "$OPS/restore.sh" "$latest" "$T/identity" dev
check "dev gateway volume back" eq "$(sqlite3 "$dv/openshell.db" 'select count(*) from sandboxes')" 0

# ------------------------------------------------------------------ health
echo "== health"
printf 'MemTotal: 8000000 kB\nMemAvailable: 4000000 kB\n' > "$T/proc/meminfo"
printf '0.10 0.20 0.30 1/200 1234\n' > "$T/proc/loadavg"
touch "$K/backup-timer"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
workloads() {
  jq -n --argjson ready "$1" '{items: [
    {kind: "Deployment", metadata: {namespace: "notch-prod", name: "notch-relay"}, spec: {replicas: 1}, status: {readyReplicas: $ready}},
    {kind: "StatefulSet", metadata: {namespace: "notch-prod", name: "openshell"}, spec: {replicas: 1}, status: {readyReplicas: 1}}]}' > "$K/workloads.json"
}
sandbox_pod() {
  jq -n --arg ns "$1" --arg name "$2" --arg oom "$3" '{
    metadata: {namespace: $ns, name: $name, labels: {"openshell.ai/managed-by": "openshell"}},
    status: {phase: "Running", containerStatuses: [{name: "agent", state: {running: {}},
      lastState: (if $oom == "" then {} else {terminated: {reason: "OOMKilled", finishedAt: $oom}} end)}]}}'
}
workloads 1
jq -n '{items: [
  {metadata: {name: "notch-prod"}, status: {health: {status: "Healthy"}, sync: {status: "Synced"}}},
  {metadata: {name: "openshell-prod"}, status: {health: {status: "Healthy"}, sync: {status: "OutOfSync"}}}]}' > "$K/apps.json"
{ sandbox_pod notch-prod sb1 ""; sandbox_pod notch-prod sb2 "$now"; } | jq -s '{items: .}' > "$K/pods.json"
jq -n '{stats: [{attributes: {labels: {"io.kubernetes.pod.namespace": "notch-prod", "io.kubernetes.pod.name": "sb1"}},
                 memory: {workingSetBytes: {value: "314572800"}}},
                {attributes: {labels: {"io.kubernetes.pod.namespace": "kube-system", "io.kubernetes.pod.name": "coredns"}},
                 memory: {workingSetBytes: {value: "1000"}}}]}' > "$K/stats.json"
printf '%s\n' '{"event":"batch","jobs":1}' 'not json' '{"event":"turn_failed","error":"timeout"}' > "$K/relay-notch-prod.log"

report="$(bash "$OPS/health.sh" 2>&1 || true)"
check "healthy host: OK" has "$report" "OK on "
check "healthy host: exit 0" quiet bash "$OPS/health.sh"
check "reports sandboxes against the cap" has "$report" "sandboxes running in notch-prod: 2 of 4"
check "reports memory per pod in notch-*" has "$report" "memory notch-prod/sb1: 300 MiB"
check "leaves other namespaces' pods out" bash -c '! grep -q coredns <<<"$1"' _ "$report"
check "reports a sandbox restarted at its memory limit" has "$report" "restarted at its memory limit: notch-prod/sb2"
check "reports relay errors, skipping non-JSON lines" has "$report" "relay notch-prod: 1 error(s) in 10 minutes, the last: turn_failed timeout"
check "reports applications out of sync" has "$report" "argocd: openshell-prod is OutOfSync"
check "reports the latest backup" has "$report" "backup: notch-"

workloads 0
check "a workload not ready fails the manual run" fails_with "Deployment notch-prod/notch-relay: 0 of 1 ready" bash "$OPS/health.sh"
check "first ping sent" quiet bash "$OPS/health.sh" --ping
check "first ping: seen once, still a success ping" eq "$(cat "$T/pings/0.conf")" 'url = "https://hc.example/check-1"'
check "first ping: says it's watching" has "$(cat "$T/pings/0.body")" "Seen once, reported if it lasts"
check "second ping sent" quiet bash "$OPS/health.sh" --ping
check "second ping in a row: reported as a failure" eq "$(cat "$T/pings/1.conf")" 'url = "https://hc.example/check-1/fail"'
check "second ping: the report says what's wrong" has "$(head -n2 "$T/pings/1.body")" "PROBLEM on "
workloads 1
check "third ping sent" quiet bash "$OPS/health.sh" --ping
check "fixed: back to a success ping" eq "$(cat "$T/pings/2.conf")" 'url = "https://hc.example/check-1"'

printf '%s\n' '{"event":"job_error"}' '{"event":"poll_error"}' '{"event":"sandbox_error"}' '{"event":"fatal"}' '{"event":"turn_failed"}' > "$K/relay-notch-prod.log"
check "relay errors over the limit" fails_with "relay notch-prod: 5 errors in 10 minutes (limit 5)" bash "$OPS/health.sh"
: > "$K/relay-notch-prod.log"

{ sandbox_pod notch-dev d1 ""; sandbox_pod notch-dev d2 ""; sandbox_pod notch-dev d3 ""; } | jq -s '{items: .}' > "$K/pods.json"
check "more sandboxes than the cap" fails_with "notch-dev: 3 sandboxes running, over the cap of 2" bash "$OPS/health.sh"
echo '{"items": []}' > "$K/pods.json"

touch -d '-30 hours' "$NOTCH_BACKUP_DIR"/notch-*.tar.gz.age
check "a stale backup" fails_with "backup: the latest is 30h old" bash "$OPS/health.sh"
touch "$NOTCH_BACKUP_DIR"/notch-*.tar.gz.age
touch "$K/backup-failed"
check "a failed backup run" fails_with "backup: the last run failed" bash "$OPS/health.sh"
rm "$K/backup-failed"

printf '0.10 0.20 999.00 1/200 1234\n' > "$T/proc/loadavg"
check "load over the limit" fails_with "load: 999.00 over 15 minutes" bash "$OPS/health.sh"
printf 'MemTotal: 8000000 kB\nMemAvailable: 100000 kB\n' > "$T/proc/meminfo"
check "memory under the limit" fails_with "memory: only 1% available (limit 5%)" bash "$OPS/health.sh"
printf 'MemTotal: 8000000 kB\nMemAvailable: 4000000 kB\n' > "$T/proc/meminfo"
printf '0.10 0.20 0.30 1/200 1234\n' > "$T/proc/loadavg"

touch "$K/api-down"
check "the API down is a problem, not a crash" fails_with "kubernetes: the API doesn't answer" bash "$OPS/health.sh"
rm "$K/api-down"

check "--ping needs HEALTHCHECK_URL" fails_with "HEALTHCHECK_URL" env NOTCH_OPS_CONFIG="$T/empty.env" bash "$OPS/health.sh" --ping

echo
if (( failures )); then echo "$failures check(s) failed"; exit 1; fi
echo "all checks passed"
