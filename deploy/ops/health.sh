#!/usr/bin/env bash
# The VPS's health (NH-35). The notch-health timer runs it every 5 minutes with
# --ping; run it by hand for the same report:
#
#   sudo /usr/local/lib/notch-ops/health.sh          print the report; exit 1 on any problem
#   sudo /usr/local/lib/notch-ops/health.sh --ping   send it to HEALTHCHECK_URL
#
# HEALTHCHECK_URL (/etc/notch/ops.env) is a dead man's switch: healthchecks.io,
# or any service with its convention. A ping to <url> means healthy, <url>/fail
# means a problem, the report goes along as the body, and the service emails an
# alert on a failure and when the pings stop — which covers the VPS or k3s
# being down. Outbound only (D-27).
#
# With --ping a problem counts only once two runs in a row have seen it, so a
# pod that restarts once doesn't page anyone; by hand every problem counts.
#
# Problems: disk, memory or load over its limit; k3s or the node down; a
# workload not ready; an Argo CD application degraded or missing; a container
# crash-looping or unable to start; more sandboxes running than the cap; relay
# errors piling up; the last backup failed or is too old.
# Also reported: sandboxes running per environment, memory per pod, containers
# restarted at their memory limit (the per-sandbox watchdog, SANDBOX_MEMORY),
# the relay's recent errors, applications out of sync, the latest backup.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/ops/lib.sh
. "$HERE/lib.sh"

PROC="${NOTCH_PROC:-/proc}"
STATE_DIR="${NOTCH_STATE_DIR:-/var/lib/notch-ops}"

ping=0
case "${1:-}" in
  --ping) ping=1 ;;
  "") ;;
  *) die "usage: $0 [--ping]" ;;
esac
require_root
require_commands kubectl jq curl
check_config_file

setting() {
  local v
  v="$(config "$1")"
  v="${v:-$2}"
  [[ $v =~ ^[0-9]+$ ]] || die "$1 must be a whole number"
  printf '%s' "$v"
}
disk_max="$(setting HEALTH_DISK_MAX_PCT 85)"
mem_min="$(setting HEALTH_MEM_MIN_PCT 10)"
load_max="$(setting HEALTH_LOAD_MAX_PER_CPU 2)"
relay_errors_max="$(setting HEALTH_RELAY_ERRORS_MAX 5)"
backup_max_hours="$(setting HEALTH_BACKUP_MAX_AGE_HOURS 26)"
declare -A sandbox_cap=(
  [notch-prod]="$(setting HEALTH_SANDBOX_CAP_PROD 4)"
  [notch-dev]="$(setting HEALTH_SANDBOX_CAP_DEV 2)"
)

# A problem has a stable key (to recognize it on the next run) and a message.
problem_keys=()
problem_messages=()
notes=()
problem() { problem_keys+=("$1"); problem_messages+=("$2"); }
note() { notes+=("$*"); }

# --------------------------------------------------------------------- host
disk_pct="$(df --output=pcent / | tail -n1 | tr -dc 0-9)"
(( disk_pct < disk_max )) || problem disk "disk: / is ${disk_pct}% full (limit ${disk_max}%)"
note "disk: / ${disk_pct}% used"

mem_total="$(awk '/^MemTotal:/ {print $2}' "$PROC/meminfo")"
mem_avail="$(awk '/^MemAvailable:/ {print $2}' "$PROC/meminfo")"
mem_pct=$(( mem_avail * 100 / mem_total ))
(( mem_pct >= mem_min )) || problem memory "memory: only ${mem_pct}% available (limit ${mem_min}%)"
note "memory: $(( mem_avail / 1024 )) of $(( mem_total / 1024 )) MiB available"

cpus="$(nproc)"
load15="$(awk '{print $3}' "$PROC/loadavg")"
if awk -v l="$load15" -v m="$(( load_max * cpus ))" 'BEGIN {exit !(l > m)}'; then
  problem load "load: $load15 over 15 minutes on $cpus CPU(s) (limit $(( load_max * cpus )))"
fi
note "load: $load15 over 15 minutes on $cpus CPU(s)"

systemctl is-active --quiet k3s || problem k3s "k3s: the service isn't running"

# ------------------------------------------------------------------ cluster
if ! nodes="$(kubectl get nodes -o json 2> /dev/null)"; then
  problem api "kubernetes: the API doesn't answer"
else
  while IFS= read -r n; do
    if [[ -n $n ]]; then problem "node:$n" "node $n isn't Ready"; fi
  done < <(jq -r '.items[] | select(([.status.conditions[]? | select(.type == "Ready")][0].status) != "True") | .metadata.name' <<<"$nodes")

  if ! workloads="$(kubectl get deployments,statefulsets -A -o json 2> /dev/null)"; then
    problem api "kubernetes: listing workloads failed"
    workloads='{"items":[]}'
  fi
  while IFS=$'\t' read -r key msg; do
    if [[ -n $key ]]; then problem "$key" "$msg"; fi
  done < <(jq -r '.items[]
    | select((.spec.replicas // 1) > 0 and (.status.readyReplicas // 0) < (.spec.replicas // 1))
    | "workload:\(.kind)/\(.metadata.namespace)/\(.metadata.name)\t\(.kind) \(.metadata.namespace)/\(.metadata.name): \(.status.readyReplicas // 0) of \(.spec.replicas // 1) ready"' <<<"$workloads")

  apps="$(kubectl -n argocd get applications.argoproj.io -o json 2> /dev/null || printf '{"items":[]}')"
  if [[ $(jq '.items | length' <<<"$apps") == 0 ]]; then
    problem argocd "argocd: no applications — is the root Application applied?"
  fi
  while IFS=$'\t' read -r key msg; do
    if [[ -n $key ]]; then problem "$key" "$msg"; fi
  done < <(jq -r '.items[]
    | (.status.health.status // "Unknown") as $h
    | select($h != "Healthy" and $h != "Progressing")
    | "app:\(.metadata.name)\targocd: \(.metadata.name) is \($h)"' <<<"$apps")
  while IFS= read -r line; do
    if [[ -n $line ]]; then note "$line"; fi
  done < <(jq -r '.items[] | select((.status.sync.status // "Unknown") != "Synced") | "argocd: \(.metadata.name) is \(.status.sync.status // "Unknown")"' <<<"$apps")

  if ! pods="$(kubectl get pods -A -o json 2> /dev/null)"; then
    problem api "kubernetes: listing pods failed"
    pods='{"items":[]}'
  fi
  while IFS=$'\t' read -r key msg; do
    if [[ -n $key ]]; then problem "$key" "$msg"; fi
  done < <(jq -r '.items[] | .metadata as $m | (.status.containerStatuses // [])[]
    | select((.state.waiting.reason // "") | IN("CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "InvalidImageName"))
    | "container:\($m.namespace)/\($m.name)/\(.name)\t\($m.namespace)/\($m.name) (\(.name)): \(.state.waiting.reason)"' <<<"$pods")
  since="$(date -u -d '-15 min' +%Y-%m-%dT%H:%M:%SZ)"
  while IFS= read -r line; do
    if [[ -n $line ]]; then note "$line"; fi
  done < <(jq -r --arg since "$since" '.items[] | .metadata as $m | (.status.containerStatuses // [])[]
    | select(.lastState.terminated.reason == "OOMKilled" and (.lastState.terminated.finishedAt // "") >= $since)
    | "restarted at its memory limit: \($m.namespace)/\($m.name) (\(.name)) at \(.lastState.terminated.finishedAt)"' <<<"$pods")

  # Sandboxes: OpenShell labels every sandbox pod it manages.
  for ns in "${NOTCH_NAMESPACES[@]}"; do
    running="$(jq --arg ns "$ns" '[.items[]
      | select(.metadata.namespace == $ns and .metadata.labels["openshell.ai/managed-by"] == "openshell" and .status.phase == "Running")] | length' <<<"$pods")"
    cap="${sandbox_cap[$ns]}"
    note "sandboxes running in $ns: $running of $cap"
    (( running <= cap )) || problem "cap:$ns" "$ns: $running sandboxes running, over the cap of $cap"
  done

  # Memory per pod without metrics-server, from the container runtime.
  if command -v k3s > /dev/null && stats="$(k3s crictl stats -o json 2> /dev/null)"; then
    while IFS= read -r line; do
      if [[ -n $line ]]; then note "$line"; fi
    done < <(jq -r '[.stats[]? | {pod: "\(.attributes.labels["io.kubernetes.pod.namespace"])/\(.attributes.labels["io.kubernetes.pod.name"])",
                                 bytes: ((.memory.workingSetBytes.value // "0") | tonumber)}]
      | map(select(.pod | startswith("notch-")))
      | group_by(.pod) | map({pod: .[0].pod, bytes: (map(.bytes) | add)}) | sort_by(-.bytes)
      | .[] | "memory \(.pod): \(.bytes / 1048576 | floor) MiB"' <<<"$stats")
  fi

  # The relay's own error events (services/relay/src; health-events.test.ts there
  # fails when the relay logs an error event this list misses).
  for ns in "${NOTCH_NAMESPACES[@]}"; do
    kubectl -n "$ns" get deployment notch-relay > /dev/null 2>&1 || continue
    errors="$(kubectl -n "$ns" logs deployment/notch-relay --since=10m 2> /dev/null \
      | jq -R -c 'fromjson? | objects | select(.event | IN("fatal", "poll_error", "job_error", "turn_failed", "sandbox_error", "sweep_failed",
                                                "sandbox_stop_failed", "sandbox_delete_failed", "provider_delete_failed",
                                                "delivery_failed", "delivery_refused", "delivery_dropped"))' || true)"
    count=0
    if [[ -n $errors ]]; then count="$(wc -l <<<"$errors")"; fi
    if (( count > 0 )); then
      note "relay $ns: $count error(s) in 10 minutes, the last: $(tail -n1 <<<"$errors" | jq -r '.event + " " + ((.error // .reason // "") | tostring)')"
    fi
    (( count < relay_errors_max )) || problem "relay:$ns" "relay $ns: $count errors in 10 minutes (limit $relay_errors_max)"
  done
fi

# ------------------------------------------------------------------ backups
if systemctl is-enabled --quiet notch-backup.timer 2> /dev/null; then
  if systemctl is-failed --quiet notch-backup.service; then
    problem backup-run "backup: the last run failed — journalctl -u notch-backup"
  fi
  latest="$(find "$NOTCH_BACKUP_DIR" -maxdepth 1 -name 'notch-*.tar.gz.age' -printf '%T@ %f\n' 2> /dev/null | sort -n | tail -n1)"
  if [[ -z $latest ]]; then
    problem backup-age "backup: none in $NOTCH_BACKUP_DIR"
  else
    age_hours=$(( ($(date +%s) - ${latest%%.*}) / 3600 ))
    note "backup: ${latest#* }, ${age_hours}h old"
    (( age_hours < backup_max_hours )) || problem backup-age "backup: the latest is ${age_hours}h old (limit ${backup_max_hours}h)"
  fi
else
  note "backup: the notch-backup timer isn't enabled"
fi

# ------------------------------------------------------------------- report
# With --ping, a problem is confirmed once the previous run saw it too.
confirmed=()
watching=()
if (( ping )); then
  install -d -m 0700 "$STATE_DIR"
  previous=()
  if [[ -f $STATE_DIR/health-problems ]]; then mapfile -t previous < "$STATE_DIR/health-problems"; fi
  for i in "${!problem_keys[@]}"; do
    seen=0
    for p in "${previous[@]}"; do
      if [[ $p == "${problem_keys[$i]}" ]]; then seen=1; break; fi
    done
    if (( seen )); then confirmed+=("${problem_messages[$i]}"); else watching+=("${problem_messages[$i]}"); fi
  done
  if (( ${#problem_keys[@]} )); then printf '%s\n' "${problem_keys[@]}"; fi > "$STATE_DIR/health-problems"
else
  confirmed=("${problem_messages[@]}")
fi

report="$(
  if (( ${#confirmed[@]} )); then
    printf 'PROBLEM on %s: %d\n' "$(hostname)" "${#confirmed[@]}"
    printf -- '- %s\n' "${confirmed[@]}"
  else
    printf 'OK on %s\n' "$(hostname)"
  fi
  if (( ${#watching[@]} )); then
    printf '\nSeen once, reported if it lasts:\n'
    printf -- '- %s\n' "${watching[@]}"
  fi
  printf '\n'
  printf '%s\n' "${notes[@]}"
)"
printf '%s\n' "$report"

if (( ping )); then
  url="$(config HEALTHCHECK_URL)"
  [[ $url =~ ^https://[^[:space:]]+$ ]] || die "HEALTHCHECK_URL in $NOTCH_OPS_CONFIG must be an https URL"
  if (( ${#confirmed[@]} )); then url="${url%/}/fail"; fi
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl_config_line url "$url" > "$tmp/curl.conf"
  printf '%s\n' "$report" > "$tmp/report"
  curl -fsS --max-time 10 --retry 3 -K "$tmp/curl.conf" --data-binary @"$tmp/report" -o /dev/null
  exit 0
fi
(( ${#confirmed[@]} == 0 ))
