#!/usr/bin/env bash
# Tests the whole Sparepartslk stack (deploy/docker/docker-compose.yml) with a freshly built image,
# the way Portainer runs it: first install, a database that disagrees, update with a database change,
# the setup screen, rollback, a broken update, a crash, the jobs (stock check, backup, restore) and the
# Neon standby copy (a second Postgres stands in for Neon, rclone's S3 server for Cloudflare R2).
# Runs on GitHub (.github/workflows/docker-image.yml) after every image build. Locally: run it in the
# foreground, one at a time (it starts several containers).
#
# Usage: deploy/docker/test/stack-test.sh <image>      e.g. sparepartslk:test
set -uo pipefail
# Git Bash on Windows rewrites arguments that look like paths (/dashboard, /tools/…); never here.
export MSYS_NO_PATHCONV=1

NEW="${1:?Usage: stack-test.sh <image>}"
cd "$(dirname "$0")/.."
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
failures=0

pass() { echo "PASS  $*"; echo "- ✅ $*" >>"$summary"; }
bad() { echo "FAIL  $*"; echo "- ❌ $*" >>"$summary"; failures=$((failures + 1)); }
note() { echo "NOTE  $*"; echo "- ℹ️ $*" >>"$summary"; }
check() { # check "<what>" <command…>
  local what="$1"
  shift
  if "$@"; then pass "$what"; else bad "$what"; fi
}

# --- Images: OLD = one database change fewer, BAD = a database change that fails ---------------
# Drizzle reads drizzle/meta/_journal.json; each entry names a <tag>.sql file.
docker build -q -t sparepartslk:old - >/dev/null <<EOF
FROM $NEW
USER root
RUN cd /tools/drizzle && node -e " \
  const fs=require('fs'); const j=JSON.parse(fs.readFileSync('meta/_journal.json','utf8')); \
  const last=j.entries.pop(); fs.unlinkSync(last.tag+'.sql'); \
  fs.writeFileSync('meta/_journal.json', JSON.stringify(j,null,2));"
USER node
EOF
docker build -q -t sparepartslk:bad - >/dev/null <<EOF
FROM $NEW
USER root
RUN cd /tools/drizzle && echo 'select * from table_that_does_not_exist;' > 9999_bad.sql && node -e " \
  const fs=require('fs'); const j=JSON.parse(fs.readFileSync('meta/_journal.json','utf8')); \
  j.entries.push({idx:j.entries.length,version:'7',when:9999999999999,tag:'9999_bad',breakpoints:true}); \
  fs.writeFileSync('meta/_journal.json', JSON.stringify(j,null,2));"
USER node
EOF
total_migrations=$(docker run --rm --entrypoint node "$NEW" -e \
  "console.log(require('/tools/drizzle/meta/_journal.json').entries.length)")

# --- Settings: the template with test values -------------------------------------------------
secret() { openssl rand -hex 24; }
SETUP_KEY="$(secret)"
OWNER_EMAIL="owner.docker@example.test"
OWNER_PASSWORD="Docker-$(secret)"
COMPANY="Docker Test Parts"
PASSPHRASE="$(secret)"
sed -e "s|^APP_VERSION=.*|APP_VERSION=test|" \
  -e "s|^COMPANY_SLUG=.*|COMPANY_SLUG=dockertest|" \
  -e "s|^PGDATA_VOLUME=.*|PGDATA_VOLUME=sparepartstest_pgdata|" \
  -e "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=http://localhost:3100|" \
  -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(secret)|" \
  -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$(secret)|" \
  -e "s|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=not-used-in-tests|" \
  -e "s|^SETUP_KEY=.*|SETUP_KEY=$SETUP_KEY|" \
  -e "s|^BACKUP_PASSPHRASE=.*|BACKUP_PASSPHRASE=$PASSPHRASE|" \
  -e "s|^R2_ACCOUNT_ID=.*|R2_ACCOUNT_ID=not-used-in-tests|" \
  -e "s|^R2_BUCKET=.*|R2_BUCKET=sparepartslk-dockertest-backup|" \
  -e "s|^R2_ACCESS_KEY_ID=.*|R2_ACCESS_KEY_ID=s3-test|" \
  -e "s|^R2_SECRET_ACCESS_KEY=.*|R2_SECRET_ACCESS_KEY=s3-test-secret|" \
  -e "s|^STANDBY_DATABASE_URL=.*|STANDBY_DATABASE_URL=postgresql://standby:standby@standby:5432/standby|" \
  -e "s|^BACKUP_PING_URL=.*|BACKUP_PING_URL=http://pingcatcher:8080/ping-ok|" \
  -e "s|^BACKUP_PING_FAIL_URL=.*|BACKUP_PING_FAIL_URL=http://pingcatcher:8080/ping-fail|" \
  stack.env.example >stack.env
# Test-only settings: rclone's S3 server in place of Cloudflare R2.
printf 'R2_ENDPOINT=http://s3:9000\nR2_PROVIDER=Rclone\n' >>stack.env

IMG="$NEW"
stack() { TEST_IMAGE="$IMG" docker compose -p sparepartstest --env-file stack.env \
  -f docker-compose.yml -f docker-compose.test.yml "$@"; }
sql() { stack exec -T db psql -U sparepartslk -d sparepartslk -tAc "$1"; }
cid() { stack ps -aq "$1"; }
migrate_exit() { docker inspect -f '{{.State.ExitCode}}' "$(cid migrate)"; }
# Read the whole log first: "logs | grep -q" stops reading at the first match, and with pipefail
# the cut-off logs command then fails the check now and then.
log_has() { # log_has <service> <text>
  local log
  log="$(stack logs --no-log-prefix "$1" 2>&1)"
  grep -q -- "$2" <<<"$log"
}
migrate_log_has() { log_has migrate "$1"; }
health_ok() { [ "$(curl -s --max-time 5 http://127.0.0.1:3100/api/health)" = "ok" ]; }
wait_healthy() { # until the app container reports healthy (max 4 minutes)
  for _ in $(seq 1 120); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$(cid app)" 2>/dev/null)" = "healthy" ] && return 0
    sleep 2
  done
  stack logs --tail 40 migrate app
  return 1
}
deploy() { # deploy <image>  — what "Update the stack" in Portainer does
  IMG="$1"
  stack up -d >/dev/null 2>&1
}
sign_in() { # sign_in <email> <password>  — the login form, like a browser
  node test/form-post.mjs http://127.0.0.1:3100/login /dashboard "email=$1" "password=$2"
}
finish() {
  stack logs --no-color >stack-test.log 2>&1 || true
  stack down -v >/dev/null 2>&1 || true
  docker volume rm sparepartstest_pgdata >/dev/null 2>&1 || true
  rm -f stack.env
}
trap finish EXIT
trap 'exit 130' INT TERM

# The database volume is "external" (made once by the person running the server, so "remove stack"
# can't delete it). The test makes and removes its own.
docker volume rm sparepartstest_pgdata >/dev/null 2>&1 || true
docker volume create sparepartstest_pgdata >/dev/null

echo "## Stack test ($NEW)" >>"$summary"

# 1. First install with the older version
deploy sparepartslk:old
check "First install: the app becomes healthy" wait_healthy
check "First install: migrate finished OK" test "$(migrate_exit)" = 0
check "First install: the setup screen waits" migrate_log_has "open the website to set up the company"
check "First install: no company before the setup screen" test "$(sql 'select count(*) from profiles')" = 0
check "Health page answers ok" health_ok
redirects_to() { # redirects_to <page> <target>: a 307 to <target>, or Next's in-page redirect to it
  local out
  out="$(curl -s --max-time 10 -w '\n%{http_code} %{redirect_url}' "http://127.0.0.1:3100$1")"
  [[ "$(tail -n 1 <<<"$out")" == 30?\ *"$2" ]] && return 0
  grep -q "NEXT_REDIRECT;replace;$2;" <<<"$out" && return 0
  echo "    $1 answered: $(tail -n 1 <<<"$out")"
  return 1
}
check "First install: the login page sends people to the setup screen" redirects_to /login /setup

# A database that disagrees with the version (a change this version doesn't know AND one of its own
# not applied) must stop, not be skipped as a rollback.
sql "insert into drizzle.__drizzle_migrations (hash, created_at) values ('test-future', 9999999999998)" >/dev/null
deploy "$NEW"
check "Database and version disagree: migrate stops" test "$(migrate_exit)" != 0
check "Database and version disagree: plain-words reason" migrate_log_has "disagree"
sql "delete from drizzle.__drizzle_migrations where hash = 'test-future'" >/dev/null
deploy sparepartslk:old
wait_healthy >/dev/null

# 2. Update to the new version (one more database change)
deploy "$NEW"
check "Update: the app becomes healthy" wait_healthy
check "Update: migrate finished OK" test "$(migrate_exit)" = 0
check "Update: every database change applied ($total_migrations)" \
  test "$(sql 'select count(*) from drizzle.__drizzle_migrations')" = "$total_migrations"
check "Update: two safety copies kept" test "$(stack exec -T jobs sh -c 'ls /backups/pre-deploy_*.dump | wc -l')" -ge 2

# The one-time setup screen, filled in like a browser. Done with the new version: sparepartslk:old is
# the new code without its newest database change, which the screen may use.
check "Setup screen: the company is set up and the owner signed in" \
  node test/form-post.mjs http://127.0.0.1:3100/setup /dashboard "setupKey=$SETUP_KEY" \
  "businessName=$COMPANY" "ownerName=Docker Test Owner" "email=$OWNER_EMAIL" \
  "password=$OWNER_PASSWORD" "confirmPassword=$OWNER_PASSWORD"
check "Login page shows the company's name" bash -c "curl -s http://127.0.0.1:3100/login | grep -q '$COMPANY'"
check "One login, the owner" test "$(sql "select count(*) || '/' || min(role) from profiles")" = "1/admin"
check "Setup screen: closed once the company exists" redirects_to /setup /login
check "The owner can sign in (login cookie given)" sign_in "$OWNER_EMAIL" "$OWNER_PASSWORD"
check "The database tools are inside the image (no download at deploy)" \
  docker run --rm --entrypoint test "$NEW" -f /tools/node_modules/drizzle-orm/package.json

# Close the key and Update the stack, as the guide says after the setup screen
sed -i -e 's|^SETUP_KEY=.*|SETUP_KEY=|' stack.env
deploy "$NEW"
check "Key closed: the app becomes healthy" wait_healthy
check "Key closed: migrate finished OK" test "$(migrate_exit)" = 0
check "Key closed: the company is already there" migrate_log_has "the company is already there"
check "Key closed: still one login" test "$(sql 'select count(*) from profiles')" = 1

# 3. Rollback to the older version over the newer database
deploy sparepartslk:old
check "Rollback: the app becomes healthy" wait_healthy
check "Rollback: migrate finished OK" test "$(migrate_exit)" = 0
check "Rollback: database left as it is" migrate_log_has "database is newer than this version"

# 4. A broken update
deploy "$NEW"
wait_healthy >/dev/null
before="$(cid app)"
deploy sparepartslk:bad
sleep 5
check "Broken update: migrate stops with a problem" test "$(migrate_exit)" != 0
check "Broken update: plain-words reason in the log" migrate_log_has "The database update failed"
# Docker stops the old app before it runs migrate, so the app is down until the version is put
# back (the guide says so). Noted rather than checked, in case Docker changes.
if health_ok && [ "$(cid app)" = "$before" ]; then
  note "Broken update: the previous app container kept running and serving"
elif health_ok; then
  note "Broken update: an app container is serving, but it was replaced"
else
  note "Broken update: the app is down until the version is changed back (as the guide says)"
fi
jobs_running() { [ "$(docker inspect -f '{{.State.Running}}' "$(cid jobs)" 2>/dev/null)" = "true" ]; }
check "Broken update: the jobs container (backups, restore console) keeps running" jobs_running
check "Broken update: the failed change left nothing behind (all or nothing)" \
  test "$(sql 'select count(*) from drizzle.__drizzle_migrations where created_at = 9999999999999')" = 0
deploy "$NEW"
check "Broken update: going back to the previous version brings the app back" wait_healthy
check "Broken update: going back finds nothing to do" migrate_log_has "already up to date"

# 5. A crash (kill -9 the app's process from outside, as the server's kernel would)
restarts_before="$(docker inspect -f '{{.RestartCount}}' "$(cid app)")"
docker run --rm --pid=host --privileged alpine:3 kill -9 "$(docker inspect -f '{{.State.Pid}}' "$(cid app)")"
sleep 5
check "Crash: Docker restarted the app" \
  test "$(docker inspect -f '{{.RestartCount}}' "$(cid app)")" -gt "$restarts_before"
check "Crash: the app becomes healthy again" wait_healthy

# 6. The jobs container: stock check and backup
check "Jobs container runs on Sri Lanka time" test "$(stack exec -T jobs date +%z)" = "+0530"
# A part whose stored quantity has no stock movements behind it: the nightly check must flag it.
sql "insert into parts (sku, name, qty_on_hand) values ('DOCKER-1', 'Docker test part', 999)" >/dev/null
sql "insert into customers (name, tier_id) select 'Docker Test Customer', id from price_tiers limit 1" >/dev/null
check "Stock check flags a wrong quantity" stack exec -T jobs reconcile-stock
check "Stock check: one difference recorded" \
  test "$(sql "select count(*) from stock_reconciliation_issues i join parts p on p.id = i.part_id where p.sku = 'DOCKER-1'")" = 1
s3_daily() { stack exec -T s3 sh -c 'ls /data/sparepartslk-dockertest-backup/daily/ 2>/dev/null' | grep -c '\.dump\.gpg$'; }
pings() { stack logs --no-log-prefix pingcatcher 2>&1; }
check "Backup: backup-now finishes OK" stack exec -T jobs backup-now
check "Backup: one encrypted backup in R2 daily/" test "$(s3_daily)" = 1
pinged() { grep -q "GET /$1" <<<"$(pings)"; }
check "Backup: the uptime monitor got the ok ping" pinged ping-ok
wrong_key_fails_loudly() {
  local out
  if out="$(stack exec -T -e R2_SECRET_ACCESS_KEY=wrong jobs backup-now 2>&1)"; then return 1; fi
  grep -q 'PROBLEM: .*No backup was saved' <<<"$out" || { echo "$out" | tail -3; return 1; }
  pinged ping-fail
}
check "Backup with a wrong R2 key fails loudly (PROBLEM line + fail ping)" wrong_key_fails_loudly
restore_practice_passes() {
  local out
  out="$(stack exec -T jobs restore-test 2>&1)"
  grep -q 'Restore practice PASSED' <<<"$out" || { echo "$out" | tail -5; return 1; }
}
check "Restore practice: the newest backup loads and the counts match" restore_practice_passes

# 7. Restore for real
restore_refused() { # it must fail AND say why
  local out
  if out="$(stack exec -T jobs restore newest --for-real 2>&1)"; then return 1; fi
  grep -q 'still running' <<<"$out"
}
check "Restore refuses while the app is running" restore_refused
sql "insert into customers (name, tier_id) select 'Added after the backup', id from price_tiers limit 1" >/dev/null
stack stop app >/dev/null 2>&1
check "Restore the newest R2 backup for real" stack exec -T jobs restore newest --for-real
check "Restore: today's database kept aside" \
  test "$(stack exec -T db psql -U sparepartslk -d postgres -tAc "select count(*) from pg_database where datname like 'sparepartslk_before_restore_%'")" = 1
deploy "$NEW" # "Update the stack", as the guide says after a restore
check "Restore: Update the stack brings the app back healthy" wait_healthy
check "Restore: the backed-up data is there" test "$(sql "select count(*) from parts where sku = 'DOCKER-1'")" = 1
check "Restore: data added after the backup is not (it was a real restore)" \
  test "$(sql "select count(*) from customers where name = 'Added after the backup'")" = 0
check "Restore: the owner can still sign in" sign_in "$OWNER_EMAIL" "$OWNER_PASSWORD"

# 8. The Neon standby (the "standby" container stands in for Neon)
ssql() { stack exec -T standby psql -U standby -d standby -tAc "$1"; }
live_counts() { stack exec -T jobs sh -c '. /usr/local/bin/common.sh; table_counts "$DATABASE_URL"'; }
standby_counts() { stack exec -T jobs sh -c '. /usr/local/bin/common.sh; table_counts "$STANDBY_DATABASE_URL" | grep -v "^standby_meta"'; }
loaded_at() { ssql "select coalesce(loaded_at::text, 'never') from standby_meta.sync" 2>/dev/null; }
backup_out="" # the last backup-now run's output
run_backup() { # run_backup [docker exec -e options…]: backup-now; output kept in backup_out
  backup_out="$(stack exec -T "$@" jobs backup-now 2>&1)"
}
said() { grep -q -- "$1" <<<"$backup_out" || { echo "$backup_out" | tail -4; return 1; }; }
fail_pinged_with() { grep -q "GET /ping-fail?msg=.*$1" <<<"$(pings)"; }

check "Standby: backup-now loads the standby" run_backup
check "Standby: the load time is recorded" test "$(ssql 'select loaded_at is not null from standby_meta.sync')" = t
check "Standby: the same rows as the live database, table by table" test "$(standby_counts)" = "$(live_counts)"
check "Standby: every table has the guard trigger" \
  test "$(ssql "select count(*) from pg_trigger where tgname like 'standby_used_%'")" = \
  "$(ssql "select count(*) from pg_tables where schemaname = 'public'")"

# The shop worked on the standby (after a switch): the next copy must NOT overwrite it.
ssql "insert into customers (name, tier_id) select 'Sale made on the standby', id from price_tiers limit 1" >/dev/null
refuses() { ! run_backup "$@" && said "has been used since the last copy" && said "R2 backup was saved"; }
check "Standby used: backup-now refuses (backup still saved)" refuses
check "Standby used: the fail ping says why" fail_pinged_with "standby"
check "Standby used: still refused with STANDBY_SYNC=on set explicitly" refuses -e STANDBY_SYNC=on
check "Standby used: the sale made there is still there" \
  test "$(ssql "select count(*) from customers where name = 'Sale made on the standby'")" = 1
check "Standby-clear: allowed after checking" stack exec -T jobs standby-clear --yes
check "Standby-clear: the next backup-now loads again" run_backup
check "Standby-clear: the standby now matches the live database again" test "$(standby_counts)" = "$(live_counts)"

# A sign-in on the standby (e.g. during the fire drill) writes a session row: that counts as used.
ssql "insert into session (token, user_id, expires_at) select 'drill-token', id, now() + interval '1 day' from \"user\" limit 1" >/dev/null
check "Standby: a sign-in there marks it as used" test "$(ssql 'select used_at is not null from standby_meta.sync')" = t
stack exec -T jobs standby-clear --yes >/dev/null 2>&1
run_backup >/dev/null

# A load that breaks halfway (here: a damaged file) must leave yesterday's standby exactly as it was.
before_load="$(loaded_at)"
before_counts="$(standby_counts)"
damaged_load_refused() {
  ! stack exec -T jobs sh -c 'pg_dump --format=custom --schema=public --schema=drizzle -f /tmp/full.dump "$DATABASE_URL" &&
    head -c $(( $(wc -c </tmp/full.dump) / 2 )) /tmp/full.dump >/tmp/half.dump && standby-load /tmp/half.dump'
}
check "Standby: a damaged load is refused" damaged_load_refused
check "Standby: after a failed load the previous copy is untouched (time)" test "$(loaded_at)" = "$before_load"
check "Standby: after a failed load the previous copy is untouched (rows)" test "$(standby_counts)" = "$before_counts"

# Neon unreachable: the R2 backup still counts, the standby is reported out of date.
daily_before="$(s3_daily)"
unreachable() { ! run_backup -e STANDBY_DATABASE_URL=postgresql://x:y@standby:1/x && said "R2 backup was saved" && said "standby is out of date"; }
check "Standby unreachable: backup-now reports it (backup still saved)" unreachable
check "Standby unreachable: one more backup in R2" test "$(s3_daily)" -gt "$daily_before"
check "Standby unreachable: the fail ping says the standby is out of date" fail_pinged_with "standby+out+of+date"
standby_off() { run_backup -e STANDBY_DATABASE_URL= && said "Standby: off"; }
check "Standby off (no address): backup-now skips it with a note" standby_off
standby_paused() { run_backup -e STANDBY_SYNC=off && said "Standby: paused"; }
check "Standby paused (STANDBY_SYNC=off): backup-now skips it with a note" standby_paused

# Back to Oracle after working on the standby: the standby's data becomes the stack's database,
# without the standby's guard triggers.
ssql "update customers set name = 'Renamed on the standby' where name = 'Docker Test Customer'" >/dev/null
stack stop app >/dev/null 2>&1
check "Back to Oracle: restore-from-standby loads the standby's data" stack exec -T jobs restore-from-standby --for-real
deploy "$NEW"
check "Back to Oracle: Update the stack brings the app back healthy" wait_healthy
check "Back to Oracle: the change made on the standby is in the stack's database" \
  test "$(sql "select count(*) from customers where name = 'Renamed on the standby'")" = 1
check "Back to Oracle: no standby guard triggers in the stack's database" \
  test "$(sql "select count(*) from pg_trigger where tgname like 'standby_used_%'")" = 0
check "Back to Oracle: the owner can sign in (writes work)" sign_in "$OWNER_EMAIL" "$OWNER_PASSWORD"
clear_then_copy() { stack exec -T jobs standby-clear --yes >/dev/null && run_backup; }
check "Back to Oracle: after standby-clear the nightly copy runs again" clear_then_copy

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed. Full log: deploy/docker/stack-test.log"
  exit 1
fi
echo "All checks passed."
