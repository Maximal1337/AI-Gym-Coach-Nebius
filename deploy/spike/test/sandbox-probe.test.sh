#!/usr/bin/env bash
# Runs deploy/spike/sandbox-probe.sh on a Linux CI runner — not in a sandbox —
# with local listeners standing in for a peer sandbox and the gateway's proxy,
# and checks that it reports what it sees. Needs netcat-openbsd. CI runs it in
# .github/workflows/ops.yml.
#
#   bash deploy/spike/test/sandbox-probe.test.sh
set -euo pipefail
PROBE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/sandbox-probe.sh"
T="$(mktemp -d)"
pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2> /dev/null || true; done
  rm -rf "$T"
}
trap cleanup EXIT

failures=0
check() {
  local name="$1"
  shift
  if "$@"; then printf 'ok   %s\n' "$name"; else printf 'FAIL %s\n' "$name"; failures=$((failures + 1)); fi
}
has() { grep -qF -- "$2" <<<"$1" || { printf '     missing %q in:\n%s\n' "$2" "$1"; return 1; }; }
lacks() { ! grep -qF -- "$2" <<<"$1" || { printf '     unexpected %q in:\n%s\n' "$2" "$1"; return 1; }; }

# A peer sandbox that accepts connections, and proxies that answer CONNECT.
nc -lk 127.0.0.1 18642 > /dev/null 2>&1 &
pids+=($!)
serve() { while true; do printf '%s\r\n\r\n' "$2" | nc -l 127.0.0.1 "$1" > /dev/null 2>&1 || true; done; }
serve 18080 'HTTP/1.1 403 Forbidden' &
pids+=($!)
serve 18081 'HTTP/1.1 200 Connection established' &
pids+=($!)
sleep 1

# The probe with a clean environment plus the given variables; prints its
# output, then its exit code on the last line.
run() {
  local code=0 out
  out="$(env -i PATH="$PATH" HOME="$T" "$@" bash "$PROBE" --peer 127.0.0.1:18642 --peer 127.0.0.1:18699 --node 127.0.0.2 --allowed api.tavily.com:443 2>&1)" || code=$?
  printf '%s\nexit %s\n' "$out" "$code"
}

out="$(run HTTPS_PROXY=http://127.0.0.1:18080 TAVILY_API_KEY=tvly-abcdefghijklmnop NEBIUS_API_KEY=placeholder API_SERVER_KEY=c2FuZGJveC1rZXktZGVyaXZlZC1ieS10aGUtcmVsYXk)"
check "a key-shaped value fails, by name only" has "$out" "FAIL   env-keys       real-looking keys in: TAVILY_API_KEY"
check "the key itself is never printed" lacks "$out" "tvly-abcdefghijklmnop"
check "other key-named variables listed for review" has "$out" "NEBIUS_API_KEY (11 chars)"
check "the sandbox's own API key isn't flagged" lacks "$out" "API_SERVER_KEY"
check "a reachable peer fails" has "$out" "FAIL   net-direct     connected to 127.0.0.1:18642"
check "an unreachable peer passes" has "$out" "PASS   net-direct     no connection to 127.0.0.1:18699"
check "the node's API port is tried" has "$out" "no connection to 127.0.0.2:6443"
check "the proxy is the positive control" has "$out" "INFO   net-control    the proxy at 127.0.0.1:18080 is reachable"
check "a refusing proxy passes" has "$out" "PASS   net-proxy      the proxy refused example.com:443 (HTTP/1.1 403 Forbidden)"
check "no service account token on the runner" has "$out" "PASS   sa-token"
# A CI runner's user can't write to system directories; root can, and the probe
# has to say so.
if (( EUID == 0 )); then
  check "system directories writable as root are reported" has "$out" "FAIL   fs-write       could write to: / /etc /usr /var"
else
  check "system directories aren't writable" has "$out" "PASS   fs-write"
fi
check "failures set the exit code" has "$out" "exit 1"

out="$(run HTTPS_PROXY=http://user:pw@127.0.0.1:18081/)"
check "a proxy that opens example.com fails (URL with credentials and a path)" \
  has "$out" "FAIL   net-proxy      the proxy opened example.com:443 (HTTP/1.1 200 Connection established)"

out="$(run HTTPS_PROXY=http://127.0.0.1:18090)"
check "an unreachable proxy makes the direct checks suspect" has "$out" "REVIEW net-control"
check "and CONNECT gets no answer" has "$out" "the proxy refused example.com:443 (none)"

# Without coreutils' timeout the network checks can't prove anything.
mkdir "$T/bin"
for c in bash env id tr grep ls awk rm getent cat sleep; do ln -s "$(command -v "$c")" "$T/bin/$c"; done
code=0
out="$(env -i PATH="$T/bin" HOME="$T" bash "$PROBE" --peer 127.0.0.1:18642 2>&1)" || code=$?
check "no timeout command: a failure, not a silent pass" has "$out" "FAIL   net-tools"
check "and no network verdicts" lacks "$out" "net-direct"
check "exit 1" test "$code" = 1

echo
if (( failures )); then echo "$failures check(s) failed"; exit 1; fi
echo "all checks passed"
