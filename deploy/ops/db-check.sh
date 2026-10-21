#!/usr/bin/env bash
# Checks that a dump of the hackathon's Supabase database restores (DOR-133):
# into a throwaway PostgreSQL on this host — never into Supabase — reachable
# only through a Unix socket in a private directory, no TCP. Then compares
# how many accounts (auth.users) and facts (public.user_facts) it holds with
# what the source held at dump time, and deletes it: it holds every account.
#
#   sudo /usr/local/lib/notch-ops/db-check.sh <dump> <source.json>
#   sudo /usr/local/lib/notch-ops/db-check.sh --archive <archive.tar.gz.age> <identity>
#
# <source.json> is what backup.sh records about the source, the manifest's
# "supabase" entry: {users, facts, roles, extensions}. backup.sh runs the
# first form on each night's dump before archiving it. The second takes an
# archive apart, for a restore drill, with the team's backup key put on the
# host for the drill only.
#
# The dump is restored without owners or grants: Supabase's own roles don't
# exist here. What its objects need does, made first from the source's list:
# the roles its policies name, NOLOGIN, and the source's extensions in their
# schemas (`extensions`, on Supabase) — those that ship with PostgreSQL;
# Supabase's own, such as pg_graphql, are named as missing. The server
# binaries are PGDG's postgresql-<major> (install.sh). Nothing of the data is
# printed: a failed COPY names its table only.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/ops/lib.sh
. "$HERE/lib.sh"

usage() { die "usage: $0 <dump> <source.json> | --archive <archive.tar.gz.age> <identity>"; }

require_root
require_commands pg_restore psql jq
(( $# == 2 || $# == 3 )) || usage

tmp="$(mktemp -d)"
pgdir=""
stop_server() {
  if [[ -n $pgdir && -f $pgdir/data/postmaster.pid ]]; then
    as_postgres "$bin/pg_ctl" -D "$pgdir/data" -m immediate stop > /dev/null 2>&1 || true
  fi
}
trap 'stop_server; rm -rf "$tmp" ${pgdir:+"$pgdir"}' EXIT

if [[ $1 == --archive ]]; then
  (( $# == 3 )) || usage
  require_commands age tar gzip
  age -d -i "$3" "$2" | gzip -dc | tar -C "$tmp" -xf - MANIFEST.json supabase
  dump="$tmp/supabase/db.dump"
  jq '.supabase' "$tmp/MANIFEST.json" > "$tmp/source.json"
  source_json="$tmp/source.json"
else
  (( $# == 2 )) || usage
  dump="$1" source_json="$2"
fi
[[ -s $dump ]] || die "no dump at $dump"
users="$(jq -r '.users // empty' "$source_json")"
facts="$(jq -r '.facts // empty' "$source_json")"
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

started=$SECONDS
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
ident='^[a-z_][a-z0-9_$-]{0,62}$'

# The roles the source's policies name; anon, authenticated and service_role
# at the least.
mapfile -t roles < <(jq -r '(.roles // []) + ["anon", "authenticated", "service_role"] | unique[]' "$source_json")
for r in "${roles[@]}"; do
  [[ $r =~ $ident ]] || die "unexpected role name in $source_json: $r"
  q "do \$\$ begin if not exists (select from pg_roles where rolname = '$r') then create role \"$r\" nologin; end if; end \$\$" > /dev/null
done

# The source's extensions, in the source's schemas, where this PostgreSQL has them.
missing=()
while IFS=$'\t' read -r name schema; do
  [[ -n $name ]] || continue
  [[ $name =~ $ident && $schema =~ $ident ]] || die "unexpected extension in $source_json: $name in $schema"
  if [[ -z $(q "select 1 from pg_available_extensions where name = '$name'") ]]; then
    missing+=("$name")
    continue
  fi
  q "create schema if not exists \"$schema\"; create extension if not exists \"$name\" schema \"$schema\" cascade" > /dev/null 2> "$tmp/ext.err" \
    || missing+=("$name ($(head -n1 "$tmp/ext.err" | sed -E 's/^(psql:[^:]*:[0-9]+: )?ERROR: +//' | cut -c1-80))")
done < <(jq -r '(.extensions // [])[] | [.name, .schema] | @tsv' "$source_json")

# pg_restore goes on past an error and reports them all; its exit status only
# says there were some.
pg_restore --no-owner --no-privileges -d postgres "$dump" 2> "$tmp/restore.err" || true
# A table's data didn't load when its COPY failed midway, or never ran (the
# table wasn't created): pg_restore names the first, and quotes the command
# of the second.
copy_failed="$(
  {
    sed -nE 's/^pg_restore: error: COPY failed for table "([^"]+)".*/\1/p' "$tmp/restore.err"
    sed -nE 's/^Command was: COPY ([^ ]+) .*/\1/p' "$tmp/restore.err" | tr -d '"'
  } | sort -u | paste -sd' ' -
)"
other="$(grep -E '^pg_restore: error:' "$tmp/restore.err" | grep -v 'COPY failed for table' \
  | sed -E 's/^pg_restore: error: (could not execute query: )?(ERROR: +)?//' | cut -c1-160 | sort | uniq -c || true)"

got_users="$(q 'select count(*) from auth.users' 2> /dev/null || echo none)"
got_facts="$(q 'select count(*) from public.user_facts' 2> /dev/null || echo none)"
tables="$(q "select count(*) from pg_tables where schemaname in ('auth', 'public')")"
log "restore check: auth.users $got_users (source $users), public.user_facts $got_facts (source $facts), $tables tables in auth and public, $(( SECONDS - started )) s"
if (( ${#missing[@]} )); then log "  extensions not made here: ${missing[*]}"; fi
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
