#!/bin/sh
# Loads a database backup into a NEW, EMPTY database. Used by restore-test, restore and
# restore-from-standby. Refuses a database that already has tables, so a live database can never be
# overwritten by mistake. All or nothing: if anything fails, the target stays empty.
#
# Usage: restore.sh <file> <target-database-url> [extra-exclude-regex]
#   <file>  a locked backup (.dump.gpg, needs BACKUP_PASSPHRASE) or a plain one (.dump)
#   extra-exclude-regex  leaves out matching entries of the backup's table of contents
#                        (restore-from-standby uses it to leave out the standby's guard triggers)
set -eu
. /usr/local/bin/common.sh

file="${1:?Usage: restore.sh <file> <target-database-url> [extra-exclude-regex]}"
target="${2:?Usage: restore.sh <file> <target-database-url> [extra-exclude-regex]}"
exclude="${3:-}"

tables="$(psql "$target" -X -A -t -v ON_ERROR_STOP=1 -c \
  "select count(*) from information_schema.tables where table_schema = 'public'")" \
  || fail "Could not open the target database."
[ "$tables" = "0" ] \
  || fail "Refused: the target database already has $tables tables. Restore only into a new, empty database."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

case "$file" in
  *.gpg)
    need_env BACKUP_PASSPHRASE
    printf '%s' "$BACKUP_PASSPHRASE" >"$work/pass"
    gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$work/pass" \
      --output "$work/db.dump" --decrypt "$file" \
      || fail "Could not unlock the backup: wrong BACKUP_PASSPHRASE, or the file is damaged."
    rm -f "$work/pass"
    dump="$work/db.dump"
    ;;
  *) dump="$file" ;;
esac

# The part search needs pg_trgm. Backups hold only the app's own schemas, not extensions.
psql "$target" -X -q -v ON_ERROR_STOP=1 -c 'create extension if not exists pg_trgm' \
  || fail "Could not add the pg_trgm extension to the target database."

# Everything in the backup except the "public" schema itself and its comment (the new database
# already has the schema, and only its owner may comment on it), and whatever the caller excludes.
pg_restore --list "$dump" >"$work/all" || fail "The backup file can't be read (damaged?)."
grep -vE ' SCHEMA - public | COMMENT - SCHEMA (- )?public | EXTENSION ' "$work/all" >"$work/list"
if [ -n "$exclude" ]; then
  grep -vE "$exclude" "$work/list" >"$work/list2" || true
  mv "$work/list2" "$work/list"
fi

pg_restore --no-owner --no-acl --exit-on-error --single-transaction \
  --use-list "$work/list" --dbname "$target" "$dump" \
  || fail "The backup could not be loaded (see the lines above). The target database was left empty."
