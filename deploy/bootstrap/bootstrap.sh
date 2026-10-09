#!/usr/bin/env bash
# Turns a fresh Ubuntu 24.04 host into the Notch cluster (NH-36): single-node
# k3s, Argo CD core, and the root Application that pulls everything else from
# Git (deploy/argocd). The same script rebuilds the cluster on a new host for
# the move to member B's credits (NH-96).
#
#   sudo deploy/bootstrap/bootstrap.sh
#   sudo deploy/bootstrap/bootstrap.sh --no-root-app   (restoring a backup: everything
#       but the root Application, which comes after deploy/ops/restore.sh)
#
# Then create the secrets (deploy/bootstrap/secrets.sh) — see deploy/README.md.
#
# Safe to re-run: every step checks what's already there. Versions are pinned
# here and changed deliberately, never pulled as "latest".
set -euo pipefail

K3S_VERSION="v1.36.4+k3s1"   # k3s stable channel on 2026-09-30
ARGOCD_VERSION="v3.5.3"
# k3s defaults, relied on by the ufw rules below and deploy/notch NetworkPolicies.
POD_CIDR="10.42.0.0/16"
SERVICE_CIDR="10.43.0.0/16"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

root_app=1
case "${1:-}" in
  --no-root-app) root_app=0 ;;
  "") ;;
  *) die "usage: $0 [--no-root-app]" ;;
esac

# ------------------------------------------------------------------ preflight
[[ $EUID -eq 0 ]] || die "run as root (sudo)"
# shellcheck disable=SC1091
. /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 24.04 ]] || die "expected Ubuntu 24.04, found ${PRETTY_NAME:-unknown}"
[[ $(uname -m) == x86_64 ]] || die "expected x86_64 (images are linux/amd64)"

# D-27: nothing but SSH may be reachable from outside. k3s listens on 6443 on
# every interface, so a host without an active firewall must not get it.
# Hardening itself is NH-31; this only refuses to run without it.
if [[ ${ALLOW_NO_FIREWALL:-0} != 1 ]]; then
  command -v ufw >/dev/null || die "ufw is not installed — harden the host first (NH-31), or set ALLOW_NO_FIREWALL=1"
  ufw status | grep -q '^Status: active' || die "ufw is inactive — harden the host first (NH-31), or set ALLOW_NO_FIREWALL=1"
  ufw status verbose | grep -qE '^Default: (deny|reject) \(incoming\)' \
    || die "ufw lets incoming traffic in by default; run 'ufw default deny incoming' (D-27)"
  if ufw status | grep -qE '^(6443(/tcp)?|Anywhere)( \(v6\))? +ALLOW( IN)? +Anywhere'; then
    die "ufw allows 6443 (or every port) from anywhere; remove that rule (D-27)"
  fi
fi

# ----------------------------------------------------------------- firewall
# Pods and services must reach the host (API server, DNS). Only in-cluster
# sources are allowed; nothing new is opened to the outside.
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  log "ufw: allow the pod and service networks to reach the host"
  ufw allow from "$POD_CIDR" to any comment 'k3s pods' >/dev/null
  ufw allow from "$SERVICE_CIDR" to any comment 'k3s services' >/dev/null
fi

# ---------------------------------------------------------------------- k3s
# No traefik or servicelb (nothing comes in, D-27), no metrics-server (RAM,
# D-31). The embedded NetworkPolicy controller stays on: OpenShell requires a
# CNI that enforces NetworkPolicy. Secrets are encrypted at rest.
log "k3s $K3S_VERSION"
install -d -m 0755 /etc/rancher/k3s
cat > /etc/rancher/k3s/config.yaml <<'EOF'
write-kubeconfig-mode: "0600"
secrets-encryption: true
disable:
  - traefik
  - servicelb
  - metrics-server
EOF
installed="$(k3s --version 2>/dev/null | awk 'NR==1 {print $3}' || true)"
if [[ $installed != "$K3S_VERSION" ]]; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="$K3S_VERSION" sh -s - server
else
  echo "already installed"
fi
for _ in $(seq 1 60); do
  kubectl get nodes >/dev/null 2>&1 && break
  sleep 2
done
kubectl wait --for=condition=Ready node --all --timeout=180s

# -------------------------------------------------------------- Argo CD core
# Core only: application controller, repo server and redis. No API server and
# no UI to expose; the CLI talks to the cluster directly (argocd --core).
log "Argo CD $ARGOCD_VERSION (core)"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd --server-side --force-conflicts \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/core-install.yaml"
# Sync waves between child Applications need the Application health check,
# which Argo CD no longer ships by default.
kubectl -n argocd patch configmap argocd-cm --type merge --patch-file "$HERE/argocd-cm-patch.yaml"
kubectl -n argocd rollout status deployment/argocd-repo-server --timeout=300s
kubectl -n argocd rollout status deployment/argocd-redis --timeout=300s
kubectl -n argocd rollout status statefulset/argocd-application-controller --timeout=300s

# ----------------------------------------------------------------- argocd CLI
if [[ "$(argocd version --client --short 2>/dev/null | awk '{print $2}' | cut -d+ -f1)" != "$ARGOCD_VERSION" ]]; then
  log "argocd CLI $ARGOCD_VERSION"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  base="https://github.com/argoproj/argo-cd/releases/download/${ARGOCD_VERSION}"
  curl -sfL -o "$tmp/argocd-linux-amd64" "$base/argocd-linux-amd64"
  curl -sfL -o "$tmp/cli_checksums.txt" "$base/cli_checksums.txt"
  (cd "$tmp" && grep ' argocd-linux-amd64$' cli_checksums.txt | sha256sum -c -)
  install -m 0755 "$tmp/argocd-linux-amd64" /usr/local/bin/argocd
fi

# ------------------------------------------------------ admin kubeconfig
# The sudo user (e.g. `claude`) gets their own copy, namespace argocd, so
# `kubectl` and `argocd --core` work without sudo. k3s' kubectl ignores
# ~/.kube/config while /etc/rancher/k3s/k3s.yaml exists, even though only root
# can read that file, so login shells point KUBECONFIG at the copy.
if [[ -n ${SUDO_USER:-} && $SUDO_USER != root ]]; then
  home="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
  install -d -m 0700 -o "$SUDO_USER" -g "$SUDO_USER" "$home/.kube"
  install -m 0600 -o "$SUDO_USER" -g "$SUDO_USER" /etc/rancher/k3s/k3s.yaml "$home/.kube/config"
  sudo -u "$SUDO_USER" env KUBECONFIG="$home/.kube/config" kubectl config set-context --current --namespace=argocd >/dev/null
  cat > /etc/profile.d/notch-kubeconfig.sh <<'EOF'
# Written by deploy/bootstrap/bootstrap.sh: k3s' kubectl reads the root-only
# /etc/rancher/k3s/k3s.yaml unless KUBECONFIG says otherwise.
if [ -z "${KUBECONFIG:-}" ] && [ "$(id -u)" -ne 0 ] && [ -r "$HOME/.kube/config" ]; then
  export KUBECONFIG="$HOME/.kube/config"
fi
EOF
  chmod 0644 /etc/profile.d/notch-kubeconfig.sh
fi

# --------------------------------------------------------------- root app
if (( ! root_app )); then
  cat <<EOF

Done, without the root Application. Restore the volumes now (deploy/README.md,
"Restoring onto a new host"), then apply it:
  sudo kubectl apply -f $HERE/root-app.yaml
EOF
  exit 0
fi
log "root Application (app of apps)"
kubectl apply -f "$HERE/root-app.yaml"

cat <<EOF

Done. Next:
  1. Secrets, per environment (values live only on this host):
       sudo $HERE/secrets.sh dev  /etc/notch/dev.env
       sudo $HERE/secrets.sh prod /etc/notch/prod.env
  2. Watch the sync:  argocd --core app list
EOF
