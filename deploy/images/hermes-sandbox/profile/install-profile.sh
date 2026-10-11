#!/bin/sh
# Installs the Notch coach profile (SOUL.md, config.yaml) into $HERMES_HOME.
# start-hermes.sh runs it before Hermes, on every start: $HERMES_HOME lives on
# the sandbox's own volume, which keeps the user's memories, skills and
# sessions across restarts — and would otherwise keep a stale profile too. Only
# the two profile files and .env are replaced; nothing else in $HERMES_HOME is
# read or changed.
#
# .env holds API_SERVER_KEY, the key of this sandbox's Hermes API (NH-55).
# Hermes reads it from there, so start-hermes.sh drops it from Hermes' own
# environment. The relay derives it as 64 lowercase hex characters; anything
# else is refused here instead of half-working later.
#
#   API_SERVER_KEY=<64 hex> install-profile.sh [profile dir]   (default: this script's directory)
set -eu

src="${1:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"
: "${HERMES_HOME:?HERMES_HOME must be set}"

for f in SOUL.md config.yaml; do
  [ -s "$src/$f" ] || { echo "install-profile: $src/$f is missing or empty" >&2; exit 1; }
done
key="${API_SERVER_KEY:-}"
case "$key" in
  *[!0-9a-f]*) key="" ;;
esac
[ ${#key} -eq 64 ] || { echo "install-profile: API_SERVER_KEY must be set, as 64 lowercase hex characters" >&2; exit 1; }

mkdir -p "$HERMES_HOME"
chmod 700 "$HERMES_HOME"
for f in SOUL.md config.yaml; do
  # Write next to the target, then rename: Hermes never sees a half-written file.
  cp "$src/$f" "$HERMES_HOME/.$f.new"
  chmod 600 "$HERMES_HOME/.$f.new"
  mv -f "$HERMES_HOME/.$f.new" "$HERMES_HOME/$f"
done
(umask 077 && printf 'API_SERVER_KEY=%s\n' "$key" > "$HERMES_HOME/.env.new")
chmod 600 "$HERMES_HOME/.env.new"
mv -f "$HERMES_HOME/.env.new" "$HERMES_HOME/.env"
echo "install-profile: SOUL.md, config.yaml and .env installed into $HERMES_HOME"
