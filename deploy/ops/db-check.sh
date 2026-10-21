#!/usr/bin/env bash
# Checks that a dump of the hackathon's Supabase database restores (DOR-133):
# into a throwaway PostgreSQL on this host — never into Supabase — reachable
# only through a Unix socket in a private directory, no TCP. Then compares
# how many accounts (auth.users) and facts (public.user_facts) it holds with
# what the source held at dump time, and deletes it: it holds every account.
#
#   sudo /usr/local/lib/notch-ops/db-check.sh <dump> <users> <facts>
#   sudo /usr/local/lib/notch-ops/db-check.sh --archive <archive.tar.gz.age> <identity>
#
# backup.sh runs the first form on each night's dump before archiving it. The
# second takes an archive apart, for a restore drill, with the team's backup
# key put on the host for the drill only.
#
# The server binaries are PGDG's postgresql-<major> (install.sh). The dump is
# restored without owners or grants: Supabase's roles don't exist here, apart
# from the three its policies name. Nothing of the data is printed — a failed
# COPY names its table only.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/ops/lib.sh
. "$HERE/lib.sh"

usage() { die "usage: $0 <dump> <users> <facts> | --archive <archive.tar.gz.age> <identity>"; }

require_root
require_commands pg_restore psql jq
(( $# == 3 )) || usage

tmp="$(mktemp -d)"
pgdir=""
stop_server() {
  if [[ -n $pgdir && -f $pgdir/data/postmaster.pid ]]; then
    as_postgres "$bin/pg_ctl" -D "$pgdir/data" -m immediate stop > /dev/null 2>&1 || true
  fi
}
trap 'stop_server; rm -rf "$tmp" ${pgdir:+"$pgdir"}' EXIT

if [[ $1 == --archive ]]; then
  require_commands age tar gzip
  age -d -i "$3" "$2" | gzip -dc | tar -C "$tmp" -xf - MANIFEST.json supabase
  dump="$tmp/supabase/db.dump"
  users="$(jq -r '.supabase.users // empty' "$tmp/MANIFEST.json")"
  facts="$(jq -r '.supabase.facts // empty' "$tmp/MANIFEST.json")"
else
  dump="$1" users="$2" facts="$3"
fi
[[ -s $dump ]] || die "no dump at $dump"
[[ $users =~ ^[0-9]+$ && $facts =~ ^[0-9]+$ ]] || die "the source's counts must be numbers (users '$users', facts '$facts')"

# The newest PostgreSQL installed, unless the tests name one.
bin="${NOTCH_PG_BIN:-$( (find /usr/lib/postgresql -mindepth 2 -maxdepth 2 -type d -name bin 2> /dev/null || true) | sort -V | tail -n1)}"
[[ -n $bin && -x $bin/initdb && -x $bin/pg_ctl ]] || die "no PostgreSQL server binaries — run deploy/ops/install.sh"

# The server never runs as root; as the postgres user PGDG's packages create.
if [[ $EUID -eq 0 ]]; then
  as_postgres() { runuser -u postgres -- "$@"; }
else
  as_postgres() { "$@"; }
fi

pgdir="$(mktemp -d "${TMPDIR:-/var/tmp}/notch-dbcheck.XXXXXX")"
if [[ $EUID -eq 0 ]]; then chown postgres: "$pgdir"; fi
as_postgres "$bin/initdb" -D "$pgdir/data" -U postgres -A trust -E UTF8 --no-locale > "$pgdir/initdb.log" 2>&1 \
  || die "initdb failed: $(tail -n1 "$pgdir/initdb.log")"
as_postgres "$bin/pg_ctl" -D "$pgdir/data" -l "$pgdir/server.log" -w -t 60 \
  -o "-c listen_addresses='' -c unix_socket_directories='$pgdir' -c fsync=off" start > /dev/null \
  || die "the temporary server didn't start: $(tail -n1 "$pgdir/server.log")"

unset PGSERVICE PGSERVICEFILE PGPASSWORD
export PGHOST="$pgdir" PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
q() { psql -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }
q "create role anon nologin; create role authenticated nologin; create role service_role nologin;" > /dev/null

# pg_restore goes on past an error and reports them all; its exit status only
# says there were some.
pg_restore --no-owner --no-privileges -d postgres "$dump" 2> "$tmp/restore.err" || true
copy_failed="$(sed -nE 's/^pg_restore: error: COPY failed for table "([^"]+)".*/\1/p' "$tmp/restore.err" | sort -u | paste -sd' ' -)"
other="$(grep -E '^pg_restore: error:' "$tmp/restore.err" | grep -v 'COPY failed for table' \
  | sed -E 's/^pg_restore: error: (could not execute query: )?(ERROR: +)?//' | cut -c1-160 | sort | uniq -c || true)"

got_users="$(q 'select count(*) from auth.users')"
got_facts="$(q 'select count(*) from public.user_facts')"
tables="$(q "select count(*) from pg_tables where schemaname in ('auth', 'public')")"
log "restore check: auth.users $got_users (source $users), public.user_facts $got_facts (source $facts), $tables tables in auth and public"
if [[ -n $other ]]; then
  log "  not restored here (Supabase-only objects):"
  while IFS= read -r line; do log "   $line"; done <<<"$other"
fi

failed=""
[[ -z $copy_failed ]] || { log "  the data of these tables didn't load: $copy_failed"; failed=1; }
[[ $got_users == "$users" ]] || { log "  auth.users differs from the source"; failed=1; }
[[ $got_facts == "$facts" ]] || { log "  public.user_facts differs from the source"; failed=1; }
[[ -z $failed ]] || die "the dump didn't restore as it should"
log "restore check passed"
