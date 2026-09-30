#!/usr/bin/env bash
# NH-26 from inside a sandbox: what the workload itself can reach. Runs under
# the sandbox's own policy, so it sees exactly what the agent's process would:
#
#   openshell sandbox upload <A> deploy/spike/sandbox-probe.sh
#   openshell sandbox exec -n <A> -- bash sandbox-probe.sh \
#     --peer <B's pod IP>:8642 --gateway <gateway service IP>:<port> --node <VPS private IP> \
#     [--allowed api.tavily.com:443]
#
# The addresses come from the host: `kubectl -n notch-dev get pods,svc -o wide`
# and `hostname -I`. Plain bash and coreutils only — the sandbox image may have
# no curl — so TCP goes through bash's /dev/tcp.
#
# One line per check: PASS, FAIL, or INFO/REVIEW for a person to read.
# Exits 1 if anything FAILs. Prints variable names, never their values.
set -uo pipefail

peers=()
allowed=()
gateway=""
node=""
while (( $# )); do
  case "$1" in
    --peer) peers+=("$2"); shift 2 ;;
    --gateway) gateway="$2"; shift 2 ;;
    --node) node="$2"; shift 2 ;;
    --allowed) allowed+=("$2"); shift 2 ;;
    *) echo "usage: $0 --peer <ip:port>… --gateway <ip:port> --node <ip> [--allowed <host:port>]…" >&2; exit 2 ;;
  esac
done

failures=0
say() { printf '%-6s %-14s %s\n' "$1" "$2" "$3"; [[ $1 == FAIL ]] && failures=$((failures + 1)); return 0; }

# Key shapes that must never be a real value in here: Tavily keys, JWTs (Token
# Factory issues them) and sk- style keys.
KEY_SHAPE='(^|[^A-Za-z0-9])(tvly-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,})'

# ---------------------------------------------------------------- identity
say INFO identity "uid $(id -u), gid $(id -g), cwd $(pwd)"

# --------------------------------------------------------------- credentials
if [[ -e /var/run/secrets/kubernetes.io/serviceaccount/token ]]; then
  say FAIL sa-token "a Kubernetes service account token is mounted"
else
  say PASS sa-token "no Kubernetes service account token"
fi

leaked=()
review=()
while IFS='=' read -r -d '' name value; do
  if [[ $value =~ $KEY_SHAPE ]]; then
    leaked+=("$name")
  elif [[ $name =~ (KEY|TOKEN|SECRET|PASSWORD) && $name != API_SERVER_KEY ]]; then
    review+=("$name (${#value} chars)")
  fi
done < /proc/self/environ
if (( ${#leaked[@]} )); then
  say FAIL env-keys "real-looking keys in: ${leaked[*]}"
else
  say PASS env-keys "no key-shaped value in the environment"
fi
if (( ${#review[@]} )); then
  say REVIEW env-names "should hold OpenShell placeholders, not keys: ${review[*]}"
fi
# API_SERVER_KEY is a real value by design: it opens only this sandbox's own agent.

if [[ -r /proc/1/environ ]]; then
  if tr '\0' '\n' < /proc/1/environ | grep -Eq "$KEY_SHAPE"; then
    say FAIL proc1-env "PID 1's environment is readable and holds a key-shaped value"
  else
    say REVIEW proc1-env "PID 1's environment is readable (no key-shaped value in it)"
  fi
else
  say PASS proc1-env "PID 1's environment isn't readable"
fi

# ---------------------------------------------------------------- filesystem
written=()
for dir in / /etc /usr /var /.openshell; do
  f="$dir/.nh26-probe-$$"
  if (: > "$f") 2> /dev/null; then written+=("$dir"); rm -f "$f"; fi
done
if (( ${#written[@]} )); then
  say FAIL fs-write "could write to: ${written[*]}"
else
  say PASS fs-write "can't write to /, /etc, /usr, /var or /.openshell"
fi
if ls /.openshell > /dev/null 2>&1; then
  say FAIL openshell-dir "/.openshell is readable"
else
  say PASS openshell-dir "/.openshell isn't readable"
fi
for dir in /tmp "$PWD"; do
  f="$dir/.nh26-probe-$$"
  if (: > "$f") 2> /dev/null; then say INFO fs-writable "$dir"; rm -f "$f"; fi
done
say INFO mounts "$(awk '$2 !~ /^\/(proc|sys|dev)/ {printf "%s(%s) ", $2, $3}' /proc/mounts 2> /dev/null)"

# ------------------------------------------------------------------ network
# A direct TCP connection to anything must fail: the sandbox's only way out is
# its gateway's proxy. Without `timeout` every attempt would "fail" and prove
# nothing, so that's a failure of its own.
if ! command -v timeout > /dev/null; then
  say FAIL net-tools "no coreutils timeout in the image: the network checks can't run"
  echo
  echo "$failures check(s) failed"
  exit 1
fi
connects() { timeout 3 bash -c "exec 3<>/dev/tcp/${1%:*}/${1##*:}" 2> /dev/null; }
direct=("${peers[@]}")
[[ -n $gateway ]] && direct+=("$gateway")
[[ -n $node ]] && direct+=("$node:6443" "$node:10250" "$node:22")
direct+=(10.43.0.1:443 169.254.169.254:80 1.1.1.1:443)
for target in "${direct[@]}"; do
  if connects "$target"; then
    say FAIL net-direct "connected to $target"
  else
    say PASS net-direct "no connection to $target"
  fi
done

if getent hosts kubernetes.default.svc.cluster.local > /dev/null 2>&1; then
  say INFO dns "cluster DNS answers from inside the sandbox"
else
  say INFO dns "cluster DNS doesn't answer"
fi

# Through the proxy, as this shell: policy binds each endpoint to the binary
# allowed to use it (the Hermes interpreter), so even allowed hosts should
# refuse a shell.
proxy="${HTTPS_PROXY:-${https_proxy:-}}"
if [[ -z $proxy ]]; then
  say INFO net-proxy "no HTTPS_PROXY set"
else
  hostport="${proxy#*://}"
  hostport="${hostport%%/*}"
  hostport="${hostport##*@}"
  # The positive control: the proxy itself must be reachable, or the direct
  # checks above passed only because /dev/tcp doesn't work here.
  if connects "$hostport"; then
    say INFO net-control "the proxy at $hostport is reachable, so the direct checks are real"
  else
    say REVIEW net-control "can't reach the proxy at $hostport either: the direct checks prove nothing"
  fi
  # The proxy's answer to CONNECT: its status line, or "none" after 3 tries.
  via_proxy() {
    local answer="" try
    for try in 1 2 3; do
      answer="$(timeout 5 bash -c '
        exec 3<>"/dev/tcp/${1%:*}/${1##*:}" || exit 1
        printf "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n" "$2" "$2" >&3
        IFS= read -r line <&3 && printf "%s" "${line%$'"'"'\r'"'"'}"
      ' _ "$hostport" "$1" 2> /dev/null)" && [[ -n $answer ]] && break
      answer=""
      (( try < 3 )) && sleep 1
    done
    printf '%s' "${answer:-none}"
  }
  status="$(via_proxy example.com:443)"
  if [[ $status =~ ^HTTP/[0-9.]+\ 2 ]]; then
    say FAIL net-proxy "the proxy opened example.com:443 ($status)"
  else
    say PASS net-proxy "the proxy refused example.com:443 (${status:-no answer})"
  fi
  for target in "${allowed[@]}"; do
    say INFO net-proxy "$target from a shell: $(via_proxy "$target")"
  done
fi

echo
if (( failures )); then echo "$failures check(s) failed"; exit 1; fi
echo "no failures; read the REVIEW and INFO lines"
