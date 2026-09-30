#!/usr/bin/env bash
# Installs the ops scripts and their timers on the VPS (NH-34, NH-35):
#
#   sudo deploy/ops/install.sh
#
# Safe to re-run, and re-run it after pulling changes to deploy/ops. The
# scripts are copied to /usr/local/lib/notch-ops, never run from the checkout:
# the timers run them as root, and the checkout belongs to a non-root user.
#
#   notch-backup.timer   nightly at 01:30 UTC: backup.sh. The first install
#                        creates the backup key pair and runs a first backup.
#   notch-health.timer   every 5 minutes: health.sh --ping. Enabled once
#                        HEALTHCHECK_URL is set in /etc/notch/ops.env.
set -euo pipefail
umask 022
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/ops/lib.sh
. "$HERE/lib.sh"

require_root

missing=()
for p in age jq sqlite3; do
  dpkg -s "$p" > /dev/null 2>&1 || missing+=("$p")
done
if (( ${#missing[@]} )); then
  log "installing ${missing[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
fi

lib=/usr/local/lib/notch-ops
install -d -m 0755 "$lib"
install -m 0644 "$HERE/lib.sh" "$lib/lib.sh"
install -m 0755 "$HERE/backup.sh" "$HERE/restore.sh" "$HERE/health.sh" "$lib/"
install -m 0644 "$HERE"/systemd/notch-*.service "$HERE"/systemd/notch-*.timer /etc/systemd/system/
systemctl daemon-reload
log "scripts in $lib"

install -d -m 0700 /etc/notch
if [[ ! -f $NOTCH_OPS_CONFIG ]]; then
  install -m 0600 "$HERE/ops.env.example" "$NOTCH_OPS_CONFIG"
  log "created $NOTCH_OPS_CONFIG from the example; fill it in with: sudoedit $NOTCH_OPS_CONFIG"
fi
check_config_file

# ------------------------------------------------------------------ backups
# The key pair archives are encrypted to. Only the public key stays on the VPS.
# Restoring onto a new host (NH-96), the team's key is put at $identity first:
# its public key is used, and no new pair is made.
identity=/root/notch-backup-identity.txt
if [[ ! -s $NOTCH_BACKUP_RECIPIENTS && -s $identity ]]; then
  age-keygen -y "$identity" > "$NOTCH_BACKUP_RECIPIENTS"
  chmod 600 "$NOTCH_BACKUP_RECIPIENTS"
  log "backups encrypted to the key in $identity — shred it once the restore is done"
elif [[ ! -s $NOTCH_BACKUP_RECIPIENTS ]]; then
  age-keygen -o "$identity" 2> /dev/null
  age-keygen -y "$identity" > "$NOTCH_BACKUP_RECIPIENTS"
  chmod 600 "$identity" "$NOTCH_BACKUP_RECIPIENTS"
  cat <<EOF

Created the backup key pair. In your own SSH session (keep the key out of any
shared terminal or transcript), copy the private key into the team's password
manager, then delete it from the VPS:
  sudo cat $identity
  sudo shred -u $identity
No backup can be restored without it. The public key stays in
$NOTCH_BACKUP_RECIPIENTS.

EOF
fi
systemctl enable --now notch-backup.timer
if [[ -z "$(find "$NOTCH_BACKUP_DIR" -maxdepth 1 -name 'notch-*.tar.gz.age' 2> /dev/null)" ]]; then
  log "first backup"
  systemctl start notch-backup.service
fi

# ------------------------------------------------------------------- health
if [[ -n "$(config HEALTHCHECK_URL)" ]]; then
  systemctl enable --now notch-health.timer
  log "notch-health.timer enabled"
else
  systemctl disable --now notch-health.timer 2> /dev/null || true
  log "notch-health.timer stays off until HEALTHCHECK_URL is set in $NOTCH_OPS_CONFIG; then re-run this"
fi

echo
"$lib/health.sh" || true
