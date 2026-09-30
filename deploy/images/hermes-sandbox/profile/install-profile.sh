#!/bin/sh
# Installs the Notch coach profile (SOUL.md, config.yaml) into $HERMES_HOME.
# The sandbox image (NH-21) runs it before starting Hermes, on every start:
# $HERMES_HOME lives on the sandbox's own volume, which keeps the user's
# memories, skills and sessions across restarts — and would otherwise keep a
# stale profile too. Only the two profile files are replaced; nothing else in
# $HERMES_HOME is read or changed.
#
#   install-profile.sh [profile dir]   (default: the directory of this script)
set -eu

src="${1:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"
: "${HERMES_HOME:?HERMES_HOME must be set}"

for f in SOUL.md config.yaml; do
  [ -s "$src/$f" ] || { echo "install-profile: $src/$f is missing or empty" >&2; exit 1; }
done

mkdir -p "$HERMES_HOME"
chmod 700 "$HERMES_HOME"
for f in SOUL.md config.yaml; do
  # Write next to the target, then rename: Hermes never sees a half-written file.
  cp "$src/$f" "$HERMES_HOME/.$f.new"
  chmod 600 "$HERMES_HOME/.$f.new"
  mv -f "$HERMES_HOME/.$f.new" "$HERMES_HOME/$f"
done
echo "install-profile: SOUL.md and config.yaml installed into $HERMES_HOME"
