# Shared helpers for the scripts in this folder (sourced, not run).
# They run inside the Sparepartslk Docker image; see docs/operations/docker-hosting.md.
# sh has no local variables: helpers use names starting with _ so they never overwrite the caller's.

# Print a line with the Sri Lanka time in front, so Portainer's log reads like a diary.
log() {
  printf '%s  %s\n' "$(TZ=Asia/Colombo date '+%Y-%m-%d %H:%M:%S')" "$*"
}

# Stop with a plain-words message (on stderr, so it still shows inside "$(...)").
fail() {
  log "PROBLEM: $*" >&2
  exit 1
}

# Stop if any of the named settings is empty: need_env DATABASE_URL BACKUP_PASSPHRASE
need_env() {
  for _setting in "$@"; do
    eval "_value=\${$_setting:-}"
    [ -n "$_value" ] || fail "Setting $_setting is missing in the stack settings (Portainer → Stacks → this stack → Environment variables)."
  done
}

# Sri Lanka date and time for file names: 2026-11-22_0230
colombo_stamp() {
  TZ=Asia/Colombo date '+%Y-%m-%d_%H%M'
}

# Where the shared SQL lives in the image.
LIB=/usr/local/lib/sparepartslk

# Sets up rclone's "r2:" for this company's bucket, from the stack settings only (no config file).
# R2_ENDPOINT / R2_PROVIDER are for testing with another S3-compatible store.
use_r2() {
  need_env R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
  [ -n "${R2_ENDPOINT:-}" ] || need_env R2_ACCOUNT_ID
  export RCLONE_CONFIG_R2_TYPE=s3
  export RCLONE_CONFIG_R2_PROVIDER="${R2_PROVIDER:-Cloudflare}"
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID:-}.r2.cloudflarestorage.com}"
  export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
}

# Downloads a backup from R2 into folder $2: the file named in $1 (e.g. daily/x.dump.gpg), or the
# newest daily one when $1 is empty. Prints the local path.
fetch_backup() {
  _wanted="$1"
  _into="$2"
  if [ -z "$_wanted" ]; then
    _newest="$(rclone lsf --files-only "r2:$R2_BUCKET/daily/" | grep '\.dump\.gpg$' | sort | tail -n 1)" \
      || fail "Could not list the backups in R2 (check the R2 settings)."
    [ -n "$_newest" ] || fail "There are no backups in R2 daily/ yet. Run backup-now first."
    _wanted="daily/$_newest"
  fi
  rclone copyto "r2:$R2_BUCKET/$_wanted" "$_into/$(basename "$_wanted")" \
    || fail "Could not download $_wanted from R2."
  printf '%s\n' "$_into/$(basename "$_wanted")"
}

# The counts people recognise, for the database at $1.
show_counts() {
  psql "$1" -X -A -t -F ' | ' -v ON_ERROR_STOP=1 -c "
    select 'customers ' || (select count(*) from customers),
           'parts ' || (select count(*) from parts),
           'invoices ' || (select count(*) from invoices),
           'payments ' || (select count(*) from payments),
           'newest invoice ' || coalesce(
             (select to_char(max(created_at) at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI')
              from invoices), 'none')"
}

# Every table in "public" with its row count, one "table|count" line each, sorted. Used to check
# that a copy (restore, standby) holds exactly what the live database held.
table_counts() {
  _tables="$(psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c \
    "select tablename from pg_tables where schemaname = 'public' order by tablename")" || return 1
  for _t in $_tables; do
    _n="$(psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from public.\"$_t\"")" || return 1
    printf '%s|%s\n' "$_t" "$_n"
  done
}

# Tells the uptime monitor how a backup went: ping ok "<message>" / ping fail "<message>".
# Never fails the caller: a monitor that can't be reached is only logged.
ping() {
  case "$1" in
    ok) _url="${BACKUP_PING_URL:-}" ;;
    *) _url="${BACKUP_PING_FAIL_URL:-}" ;;
  esac
  [ -n "$_url" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-urlencode "msg=$2" -G "$_url" \
    || log "(The uptime monitor could not be reached: $1 ping not sent.)"
  return 0
}
