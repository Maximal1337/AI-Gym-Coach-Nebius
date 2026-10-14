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
# SOUL.md also goes next to Hermes' state database. Hermes takes the agent's
# identity from the SOUL.md beside that database, and in NemoClaw's image
# $HERMES_HOME/state.db is a link into $HERMES_HOME/runtime. With SOUL.md in
# $HERMES_HOME alone, every reply came from Hermes' default "Hermes Agent"
# identity, with none of the coach's rules in the prompt (seen in the spike,
# NH-23).
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
# <file> <directory>: written next to the target, then renamed, so Hermes never
# sees a half-written file.
install_file() {
  cp "$src/$1" "$2/.$1.new"
  chmod 600 "$2/.$1.new"
  mv -f "$2/.$1.new" "$2/$1"
}
for f in SOUL.md config.yaml; do install_file "$f" "$HERMES_HOME"; done
(umask 077 && printf 'API_SERVER_KEY=%s\n' "$key" > "$HERMES_HOME/.env.new")
chmod 600 "$HERMES_HOME/.env.new"
mv -f "$HERMES_HOME/.env.new" "$HERMES_HOME/.env"
also=""
state_dir="$(dirname -- "$(readlink -f -- "$HERMES_HOME/state.db" 2>/dev/null || printf '%s\n' "$HERMES_HOME/state.db")")"
if [ -d "$state_dir" ] && [ "$state_dir" != "$(readlink -f -- "$HERMES_HOME")" ]; then
  install_file SOUL.md "$state_dir"
  also=" (SOUL.md also into $state_dir, beside state.db)"
fi
echo "install-profile: SOUL.md, config.yaml and .env installed into $HERMES_HOME$also"
