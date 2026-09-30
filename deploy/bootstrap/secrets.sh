#!/usr/bin/env bash
# Creates one environment's secrets from an env file that exists only on the
# VPS (D-32: no secrets in Git, and the repository is public).
#
#   sudo deploy/bootstrap/secrets.sh dev  /etc/notch/dev.env
#   sudo deploy/bootstrap/secrets.sh prod /etc/notch/prod.env
#
# The env file: plain KEY=value lines, no quotes, owned by root, mode 600 —
# see secrets.env.example. It's parsed, never sourced or executed.
#
# Creates in notch-<env>:
#   notch-relay               the relay's configuration (updated on every run)
#   openshell-credential-kek  the key the gateway encrypts provider credentials
#                             with — created once, never replaced. Losing it
#                             loses the stored credentials: back it up with the
#                             gateway volume (NH-34) and carry it to a new host
#                             (NH-96) with this script's --restore-kek.
set -euo pipefail
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() { die "usage: $0 dev|prod <env file> [--restore-kek <file with the base64 key>]"; }

[[ $EUID -eq 0 ]] || die "run as root (sudo)"
[[ $# -eq 2 || $# -eq 4 ]] || usage
env="$1"
file="$2"
[[ $env == dev || $env == prod ]] || usage
restore_kek=""
if [[ $# -eq 4 ]]; then
  [[ $3 == --restore-kek ]] || usage
  restore_kek="$4"
  [[ -f $restore_kek ]] || die "$restore_kek not found"
fi
ns="notch-$env"

[[ -f $file ]] || die "$file not found"
[[ $(stat -c '%U' "$file") == root ]] || die "$file must be owned by root"
[[ $(stat -c '%a' "$file") =~ ^[46]00$ ]] || die "$file must be mode 600 or 400 (chmod 600 $file)"

# The value of KEY from the env file: the first KEY= line, everything after '='.
# A CRLF file (edited on Windows) reads the same as LF.
value() { grep -m1 -E "^$1=" "$file" | cut -d= -f2- | tr -d '\r' || true; }

required=(RELAY_SECRET SUPABASE_FUNCTIONS_URL TOKEN_FACTORY_MODEL)
optional=(RELAY_STATIC_SANDBOXES)
for key in "${required[@]}"; do
  [[ -n "$(value "$key")" ]] || die "$key is missing or empty in $file"
done
(( $(value RELAY_SECRET | tr -d '\n' | wc -c) >= 32 )) || die "RELAY_SECRET must be at least 32 characters (the Edge Functions refuse shorter ones)"
[[ $(value SUPABASE_FUNCTIONS_URL) =~ ^https://[a-z0-9]+\.supabase\.co/functions/v1/?$ ]] \
  || die "SUPABASE_FUNCTIONS_URL must look like https://<project-ref>.supabase.co/functions/v1"

# The namespace normally comes from Argo CD (notch-<env> app); create it if
# this runs first — Argo CD adopts it on its next sync.
kubectl get namespace "$ns" >/dev/null 2>&1 || kubectl create namespace "$ns"

tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT

# Values go through a 600 temp file, never the command line (ps would show them).
: > "$tmp/relay.env"
for key in "${required[@]}" "${optional[@]}"; do
  v="$(value "$key")"
  if [[ -n $v ]]; then printf '%s=%s\n' "$key" "$v" >> "$tmp/relay.env"; fi
done
kubectl -n "$ns" create secret generic notch-relay --from-env-file="$tmp/relay.env" \
  --dry-run=client -o yaml | kubectl apply -f -
# The relay reads its environment at start; pick up the new values.
if kubectl -n "$ns" get deployment notch-relay >/dev/null 2>&1; then
  kubectl -n "$ns" rollout restart deployment/notch-relay
fi

if kubectl -n "$ns" get secret openshell-credential-kek >/dev/null 2>&1; then
  echo "openshell-credential-kek already exists in $ns — left as is"
else
  if [[ -n $restore_kek ]]; then
    tr -d '\n' < "$restore_kek" > "$tmp/kek"
  else
    # 32 random bytes, base64 — the form the chart itself generates.
    head -c 32 /dev/urandom | base64 -w0 > "$tmp/kek"
  fi
  [[ $(base64 -d < "$tmp/kek" 2>/dev/null | wc -c) -eq 32 ]] || die "the key-encryption key must be 32 bytes, base64-encoded"
  kubectl -n "$ns" create secret generic openshell-credential-kek --from-file=key-encryption-key="$tmp/kek"
  echo "created openshell-credential-kek in $ns — back it up now (NH-34):"
  echo "  kubectl -n $ns get secret openshell-credential-kek -o jsonpath='{.data.key-encryption-key}' | base64 -d"
fi
echo "secrets for $ns are in place"
