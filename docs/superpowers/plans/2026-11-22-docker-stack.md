# Docker stack with Neon standby: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Sparepartslk to a new company as one private Docker image and stack on the Oracle server, with nightly encrypted R2 backups that are restored into a Neon standby every night, and a Vercel emergency copy of the app.

**Architecture:** One image runs as `migrate`, `app` and `jobs` (skill rules 1–2). The stack is `db` (postgres:17) → `migrate` → `app`, plus `jobs` and `tunnel`. The jobs container runs the stock check and the nightly chain: dump → gpg → R2 → download back → load into Neon in one transaction (guarded against overwriting a standby that has been used) → row-count check → ping. A GitHub workflow builds on arm64, runs the full stack test and pushes to ghcr. A second workflow deploys a given tag to a Vercel standby project in `iad1`.

**Tech Stack:** Next.js 16 (standalone output), Node 24, pnpm 9.15.9, Drizzle + postgres-js, Postgres 17, gpg, rclone, supercronic, cloudflared, Portainer, GitHub Actions (`ubuntu-24.04-arm`), MinIO (CI only), Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-11-22-docker-stack-design.md`. Read it together with the skill `docker-company-hosting` (rules 1–30, `references/*.md`, `examples/washer-help/*`). The Washer Help files are the model for every script below. Copy their shape (POSIX `sh`, `set -eu`, `log`/`fail`/`need_env`, `PROBLEM:` lines) and change the names.

## Global Constraints

- Postgres **17** everywhere: `db` image, `pg_dump`/`pg_restore`/`psql` client in the image, Neon standby (spec §2).
- Image: `ghcr.io/mrasika/sparepartslk:<release tag>`, private, built on `ubuntu-24.04-arm` (arm64). Never `latest` in a stack.
- Node 24 base (`node:24-bookworm-slim`), pnpm `9.15.9` via corepack, `USER node`, `HOSTNAME=0.0.0.0`, `PORT=3000`, `NEXT_TELEMETRY_DISABLED=1`, `NEXT_OUTPUT=standalone` at build only.
- No `ports:` in `docker-compose.yml`. The test override publishes `127.0.0.1:3100:3000` only.
- Company time zone `Asia/Colombo` on `jobs`; `TZ: UTC` on `app`.
- The database connection is direct everywhere (stack → `db`; Vercel → Neon **direct** address). Never a transaction-mode pooler (postgres-js loses queries there).
- Backups cover schemas `public` and `drizzle` only, custom format, `--no-owner --no-acl`.
- Every script message a non-developer reads is plain words. Failures start with `PROBLEM:`.
- The current shop's `deploy.yml`, `vercel.json` (`syd1`) and Supabase setup stay unchanged.
- Work happens on branch `feat/docker-stack`, cut from `development` after `chore/next-16` has merged.

## Review Focus

1. **A standby the shop worked on gets overwritten.** Expected: the load refuses, even with `STANDBY_SYNC=on`, until `standby-clear`. Test: Task 6, check `standby refuses after use`.
2. **The nightly load dies partway (network drop, Neon limit).** Expected: Neon keeps yesterday's data unchanged. Test: Task 6, check `failed load keeps previous standby`.
3. **The fire drill signs someone in on the standby.** Expected: that counts as "used" (a session row is written), and the guide says to run `standby-clear` after a drill. Test: Task 6, check `sign-in on standby marks used`.
4. **`restore-from-standby` carries the standby's guard triggers into the Oracle database.** Expected: the restored stack database has no `standby_used_*` triggers and accepts writes. Test: Task 6, check `restored stack db has no standby triggers`.
5. **Neon is unreachable or `STANDBY_DATABASE_URL` is empty.** Expected: the R2 backup still completes and counts as saved; the log and the failure ping say the standby is out of date. Test: Task 6, checks `standby unreachable keeps backup` and `standby off skips with note`.

---

### Task 0: Branch and design doc

**Files:**
- Add: `docs/superpowers/specs/2026-11-22-docker-stack-design.md`, `docs/superpowers/plans/2026-11-22-docker-stack.md`

- [ ] **Step 1:** Confirm `chore/next-16` is merged into `development` (`git log origin/development --oneline | grep -i "next 16"`). If not, stop and ask the owner.
- [ ] **Step 2:** `git switch -c feat/docker-stack origin/development`
- [ ] **Step 3:** Commit both docs: `git commit -m "docs: Docker stack with Neon standby design and plan"`

### Task 1: App settings for Docker

**Files:**
- Modify: `src/server/db/client.ts` (pool options)
- Modify: `.env.example`
- Test: `tests/services/db-pool.test.ts`

**Interfaces:**
- Produces: `poolMax(env?: string): number`, exported from `src/server/db/client.ts`. It returns `Number(env)` when that is an integer from 1 to 50, else `4`. The client uses `max: poolMax(process.env.DB_POOL_MAX)`.

- [ ] **Step 1: Write the failing test** `tests/services/db-pool.test.ts`:
  - `poolMax(undefined) === 4`; `poolMax("") === 4`; `poolMax("10") === 10`; `poolMax("0") === 4`; `poolMax("51") === 4`; `poolMax("abc") === 4`; `poolMax("2.5") === 4`.
- [ ] **Step 2:** `pnpm vitest run tests/services/db-pool.test.ts`. Expected: FAIL, `poolMax` is not exported.
- [ ] **Step 3:** Implement `poolMax`. Update the comment in `client.ts`: in the Docker stack the app talks straight to `db`, so a larger pool is fine (`DB_POOL_MAX`).
- [ ] **Step 4:** Run the test again. Expected: PASS. Then run `pnpm test`. Expected: all pass.
- [ ] **Step 5:** Add `DB_POOL_MAX=` to `.env.example` with the comment `# Optional, default 4. The Docker stack uses 10 (it talks straight to its own database).`
- [ ] **Step 6:** Check that the standalone build keeps the PDF fonts. Run `NEXT_OUTPUT=standalone pnpm build`, then `ls .next/standalone/node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/Helvetica.afm`. Expected: the file exists. If it is missing, widen `outputFileTracingIncludes` in `next.config.ts` until it exists.
- [ ] **Step 7:** Commit `feat(docker): DB_POOL_MAX setting`.

### Task 2: Migration runner and rollback check

**Files:**
- Create: `deploy/docker/lib/migration-state.mjs` (pure decision, no I/O)
- Create: `deploy/docker/bin/db-migrate.mjs` (reads DB + journal, decides, runs Drizzle's migrator)
- Test: `tests/services/migration-state.test.ts`

**Interfaces:**
- Produces: `migrationState({ applied, journal }) → { action: "migrate" | "rollback" | "disagree" | "up-to-date", newer: number[], pending: number[] }`.
  - `applied` = `created_at` values (numbers) from `drizzle.__drizzle_migrations` (empty if the table is missing).
  - `journal` = `when` values from `drizzle/meta/_journal.json` entries.
  - `newer` = applied values not in `journal`. `pending` = journal values greater than `max(applied)` (all of them when `applied` is empty).
  - Decision: `newer` non-empty and `pending` empty → `"rollback"`. Both non-empty → `"disagree"`. `pending` non-empty only → `"migrate"`. Neither → `"up-to-date"`.
- Produces: `node /tools/db-migrate.mjs`. Exit 0 on migrate / rollback / up-to-date, printing one line per outcome: `MIGRATED <n>`, `ROLLBACK newer=<list>`, `UP-TO-DATE`. Exit 3 printing `DISAGREE newer=<list> pending=<list>` on disagree. Exit 1 on a migrator error. Reads `DATABASE_URL`; migrations folder `/tools/drizzle`.
- Drizzle's Postgres migrator applies all pending migrations in one transaction, so an "unfinished migration" state can't happen. The skill's "did not finish" check is replaced by Drizzle's atomic apply. Note this in a comment in `migrate` (Task 4).

- [ ] **Step 1: Write the failing tests** `tests/services/migration-state.test.ts`. Use journal `[1,2,3]`.
  - `applied []` → `migrate`, pending `[1,2,3]`
  - `applied [1,2]` → `migrate`, pending `[3]`
  - `applied [1,2,3]` → `up-to-date`
  - `applied [1,2,3,4]` → `rollback`, newer `[4]`
  - `applied [1,2,4]` with journal `[1,2,3,5]` → `disagree`, newer `[4]`, pending `[5]`
- [ ] **Step 2:** `pnpm vitest run tests/services/migration-state.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `migration-state.mjs` (plain ESM, JSDoc types, no dependencies).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Implement `db-migrate.mjs` with `postgres` (`max: 1`) and `drizzle-orm/postgres-js/migrator` (`migrate(db, { migrationsFolder: "/tools/drizzle" })`). It reads the applied list only if `to_regclass('drizzle.__drizzle_migrations')` is not null.
- [ ] **Step 6:** Smoke test against the local test database:
  `DATABASE_URL=$TEST_DATABASE_URL_SCRATCH node deploy/docker/bin/db-migrate.mjs` (with the folder path overridable by `MIGRATIONS_DIR` for local runs). Make the scratch database with `createdb` against local Supabase Postgres. Expected: `MIGRATED 14` (or the current count), then on a second run `UP-TO-DATE`. Drop the scratch database afterwards.
- [ ] **Step 7:** Commit `feat(docker): migration runner with rollback check`.

### Task 3: Dockerfile

**Files:**
- Create: `Dockerfile`, `.dockerignore`

**Interfaces:**
- Produces an image where:
  - `/app` holds the standalone server (`node server.js`), `public/` and `.next/static`;
  - `/tools` holds `db-migrate.mjs`, `lib/migration-state.mjs`, `drizzle/` and a `node_modules` with only `drizzle-orm` and `postgres` at the lockfile versions;
  - `/usr/local/bin` holds every `deploy/docker/bin/*` script (mode 755);
  - `/backups` is owned by `node`.
- Tools in the final stage: `postgresql-client-17` (PGDG apt repo), `gnupg`, `rclone` (current release binary with a pinned version and checksum, not Debian's), `curl`, and `supercronic` (pinned version + sha1 per `TARGETARCH`).
- Build args `APP_VERSION`, `GIT_SHA` become env vars.

- [ ] **Step 1:** Write the `Dockerfile` with stages `deps`, `build`, `tools` and `final`, following `examples/washer-help/Dockerfile`. Replace Prisma with the `/tools` layout above and npm with `corepack enable && pnpm install --frozen-lockfile`. The build stage sets dummy `DATABASE_URL` and `BETTER_AUTH_SECRET` values (build stage only) and `NEXT_OUTPUT=standalone`.
- [ ] **Step 2:** Write `.dockerignore`, following the skill: `node_modules`, `.next*`, `.git`, `.github`, `.env*` except `.env.example`, `e2e*`, `tests`, `docs`, `test-results`, `playwright-report`, `.next-stress`, `deploy/docker/stack.env`.
- [ ] **Step 3:** Build locally: `docker build -t sparepartslk:local --build-arg APP_VERSION=dev .`. Expected: success.
- [ ] **Step 4:** Smoke test:
  `docker run --rm -d -p 127.0.0.1:3100:3000 -e DATABASE_URL=postgres://x:y@127.0.0.1:1/x -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) --name sp-smoke sparepartslk:local`
  then `curl -s http://127.0.0.1:3100/api/health`. Expected: `ok`. Then check the tools: `docker exec sp-smoke sh -c 'pg_dump --version; gpg --version | head -1; rclone version | head -1; supercronic -version; id -un'`. Expected: `pg_dump (PostgreSQL) 17.x`, versions printed, `node`. Then `docker rm -f sp-smoke`.
- [ ] **Step 5:** Commit `feat(docker): Dockerfile`.

### Task 4: Stack file, migrate script, stack test (install, update, rollback, failure, crash)

**Files:**
- Create: `deploy/docker/docker-compose.yml`, `deploy/docker/stack.env.example`, `deploy/docker/docker-compose.test.yml`
- Create: `deploy/docker/bin/common.sh`, `deploy/docker/bin/migrate`
- Create: `deploy/docker/test/stack-test.sh`, `deploy/docker/test/setup-company.mjs`

**Interfaces:**
- `common.sh` produces `log`, `fail`, `need_env`, `colombo_stamp`, `use_r2`, `fetch_backup <file|""> <dir>`, `show_counts <url>`, `table_counts <url>` (one `table|count` line per table in `public`, sorted) and `ping <ok|fail> <message>`. `ping` calls `BACKUP_PING_URL` or `BACKUP_PING_FAIL_URL` when set, never fails the caller, and logs if the ping itself failed.
- `show_counts` prints: `customers`, `parts`, `invoices`, `payments`, and `newest invoice` (`max(created_at)` in Colombo time) for this schema.
- Compose services, exactly as in the spec §5.1. The `db` volume is **external**: `name: ${PGDATA_VOLUME:?Set PGDATA_VOLUME}`. A `backups` named volume. `DATABASE_URL` defaults to `postgres://sparepartslk:${DB_PASSWORD}@db:5432/sparepartslk`. `DB_POOL_MAX` defaults to 10. `app` gets `CLIENT_IP_HEADER=cf-connecting-ip`.
- `stack.env.example` lines, grouped and explained (skill §3), including: `APP_VERSION`, `COMPANY_SLUG`, `PGDATA_VOLUME`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DB_PASSWORD`, `TUNNEL_TOKEN`, `SETUP_KEY`, `BACKUP_PASSPHRASE`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BACKUP_SCHEDULE=30 2 * * *`, `STANDBY_DATABASE_URL`, `STANDBY_SYNC=on`, `BACKUP_PING_URL`, `BACKUP_PING_FAIL_URL`, `FEATURE_SALES_TARGET`, `RESEND_API_KEY`, `EMAIL_FROM`.
- Test override: `image: ${TEST_IMAGE}` on app/migrate/jobs; app port `127.0.0.1:3100:3000`; tunnel under profile `never`; the external volume replaced by a local named volume for the test; services `standby` (postgres:17), `minio` (pinned image, bucket created by a one-shot `minio/mc` service) and `pingcatcher` (`python:3-alpine` running `python -m http.server 8080`, whose request log is read by the test).
- `stack-test.sh` produces `pass` / `bad` / `note`, `stack()`, `deploy <image>`, `wait_healthy <service>` and `finish` (skill `stack-test.md`). NEW / OLD / BAD images are made as in the skill: OLD = NEW minus the newest `drizzle/` file and journal entry; BAD = NEW plus `drizzle/9999_bad.sql` with `select * from table_that_does_not_exist;` and its journal entry.

- [ ] **Step 1: Write the stack test first** with the skill's scenarios 1–8 (first install with OLD, database disagrees, update to NEW, setup screen, close the key, rollback, broken update, crash). Changes for this project:
  - "company exists" = `select count(*) from profiles` > 0;
  - the setup form fields come from `src/app/(auth)/setup/setup-form.tsx` (`setupKey`, `businessName`, `ownerName`, and the owner email and password fields as named there);
  - "the migration engine is inside the image" = `docker run --rm $NEW node /tools/db-migrate.mjs --help`, or a `test -f /tools/node_modules/drizzle-orm/package.json`;
  - the broken-update scenario expects `migrate` to exit non-zero with `The database update failed`. Drizzle rolls the whole batch back, so there is no "did not finish" re-try check (replaced by: redeploying NEW after BAD succeeds and the database has no `9999` row).
- [ ] **Step 2:** Run it: `IMAGE=sparepartslk:local bash deploy/docker/test/stack-test.sh`. Expected: FAIL (no compose file yet). Run local stack tests in the foreground, one at a time (local memory limits).
- [ ] **Step 3:** Write `docker-compose.yml`, `stack.env.example` and `docker-compose.test.yml`.
- [ ] **Step 4:** Write `common.sh` and `migrate`, following the example's order: wait for DB → safety copy (keep 5, seconds in the name) → `node /tools/db-migrate.mjs` → interpret its line or exit code into the example's plain-words messages (`DISAGREE` → the "disagree" PROBLEM; `ROLLBACK` → "The database is newer than this version (a rollback): left as it is"; exit 1 → "The database update failed …") → empty-database message and `SETUP_KEY` length check → `Finished OK`.
- [ ] **Step 5:** Rebuild the image and run the stack test. Expected: every check ✅ for scenarios 1–8.
- [ ] **Step 6:** Commit `feat(docker): stack, migrate job and stack test`.

### Task 5: Jobs container: stock check, backup, restore

**Files:**
- Create: `deploy/docker/bin/jobs-start`, `deploy/docker/bin/crontab.template`, `deploy/docker/bin/reconcile-stock`, `deploy/docker/bin/backup-now`, `deploy/docker/bin/restore.sh`, `deploy/docker/bin/restore-test`, `deploy/docker/bin/restore`
- Modify: `deploy/docker/test/stack-test.sh` (scenarios 9–10 + stock check)

**Interfaces:**
- `jobs-start`: `need_env DATABASE_URL BACKUP_PASSPHRASE R2_*`, then writes the crontab from `crontab.template`, substituting `BACKUP_SCHEDULE` (default `30 2 * * *`). The stock check is fixed at `0 2 * * *` (company time). Then `supercronic -test`, prints the schedule and the console commands, `exec supercronic`.
- `reconcile-stock`: `psql -c "select public.reconcile_stock()"`, logs `Stock check: <n> new difference(s)`.
- `backup-now` (this task: steps 1–2 of spec §5.3 only; Task 6 extends it): dump → `gpg --batch --symmetric --cipher-algo AES256 --passphrase-file` (file removed right after) → `rclone copyto r2:$R2_BUCKET/daily/sparepartslk-<slug>_<stamp>.dump.gpg` (+ `monthly/` on day 01) → log the size → `ping ok`. On failure: `ping fail` + `PROBLEM: No backup was saved …`.
- `restore.sh <file> <target-url>` (shared): unlock `.gpg` if needed, `create extension if not exists pg_trgm`, then `pg_restore --no-owner --no-acl --single-transaction --exit-on-error`.
- `restore-test`, `restore <file|newest|safety-copy> --for-real`: as in the examples. `restore` refuses while `http://app:3000/api/health` answers, renames the database aside (`sparepartslk_before_restore_<stamp>`), and puts it back if loading fails.

- [ ] **Step 1: Add the failing stack-test checks:**
  - `jobs runs in Asia/Colombo`;
  - `reconcile-stock flags a wrong quantity`: set one part's `qty_on_hand` to 999 with no movement, run `docker compose exec jobs reconcile-stock`, expect 1 new row in `stock_reconciliation_issues`;
  - `backup-now saves to R2`: MinIO lists one `daily/*.dump.gpg`, and pingcatcher's log has the ok path;
  - `backup with a wrong R2 key fails loudly`: expect a `PROBLEM: No backup was saved` line and the fail ping path;
  - `restore-test counts match`;
  - restore scenario 10 from the skill (refused while the app runs → stop app → `restore newest --for-real` → old database kept aside → Update the stack → healthy → data there).
- [ ] **Step 2:** Run the stack test. Expected: the new checks ❌.
- [ ] **Step 3:** Write the scripts above. For MinIO in tests, set `R2_ENDPOINT=http://minio:9000` and `R2_PROVIDER=Minio` (`use_r2` already allows both).
- [ ] **Step 4:** Rebuild and run the stack test. Expected: all ✅.
- [ ] **Step 5:** Commit `feat(docker): jobs container with stock check, backup and restore`.

### Task 6: Neon standby: nightly load, guard, way back

**Files:**
- Create: `deploy/docker/bin/standby-load`, `deploy/docker/bin/standby-now`, `deploy/docker/bin/standby-status`, `deploy/docker/bin/standby-clear`, `deploy/docker/bin/restore-from-standby`, `deploy/docker/lib/standby-guard.sql`
- Modify: `deploy/docker/bin/backup-now` (append steps 3–6), `deploy/docker/test/stack-test.sh`

**Interfaces:**
- Standby bookkeeping lives in schema `standby_meta` on the standby only: table `sync(id int primary key default 1 check (id = 1), loaded_at timestamptz, source_version text, used_at timestamptz)`, plus function `standby_meta.mark_used()` (a statement-level trigger function that sets `used_at = now()` where `used_at is null`).
- `standby-load <plain .dump file>` sends **one** `psql --single-transaction -v ON_ERROR_STOP=1` session to `STANDBY_DATABASE_URL`, in this order:
  1. create `standby_meta` objects if missing; `create extension if not exists pg_trgm`;
  2. guard: `select used_at from standby_meta.sync for update`; if not null, `raise exception 'STANDBY_USED %', used_at`;
  3. the output of `pg_restore --clean --if-exists --no-owner --no-acl -f - <file>`;
  4. on every table in `public`: `create trigger standby_used_<table> after insert or update or delete or truncate on public.<table> for each statement execute function standby_meta.mark_used()`;
  5. upsert `sync` with `loaded_at = now()`, `source_version = $APP_VERSION`, `used_at = null`.
  - `STANDBY_USED` → exit 4 with `PROBLEM: the standby has been used since the last copy (at <time>) — not overwriting it. If the shop is back on Oracle and the data has been brought back, run standby-clear.` Any other error → exit 1 with `PROBLEM: the standby could not be loaded — it still has the previous copy.`
- `backup-now` steps 3–6 (spec §5.3) run after a successful upload, unless `STANDBY_DATABASE_URL` is empty (log `Standby: off (no STANDBY_DATABASE_URL) — skipped`) or `STANDBY_SYNC` ≠ `on` (log `Standby: paused (STANDBY_SYNC=off) — skipped`). Order:
  1. `fetch_backup daily/<that file>`;
  2. unlock;
  3. `standby-load`;
  4. compare `table_counts` of the live database (taken right after the dump) with the standby's `public` tables;
  5. `ping ok` with sizes and counts.
  - A standby failure → `ping fail "standby out of date: <reason>"`. The log says the R2 backup **was** saved. Exit non-zero so supercronic logs it.
- `standby-now`: runs steps 3–6 against the newest R2 backup. `standby-status`: prints `loaded_at`, `source_version`, `used_at` and standby counts against live counts. `standby-clear --yes`: sets `used_at = null` and logs who/when to stdout.
- `restore-from-standby --for-real`: refuses while the app answers, then:
  1. `pg_dump --schema=public --schema=drizzle --format=custom` from the standby;
  2. `pg_restore -l` → drop every line whose name starts with `standby_used_` → `pg_restore -L <list>` through the same rename-aside load as `restore`;
  3. tell the operator to Update the stack, switch DNS back, then `standby-clear` and set `STANDBY_SYNC=on`.

- [ ] **Step 1: Add the failing stack-test checks** (the `standby` service stands in for Neon):
  - `backup-now loads the standby`: the standby's `standby_meta.sync.loaded_at` is set, and standby counts equal the live counts;
  - `standby has guard triggers`: `select count(*) from pg_trigger where tgname like 'standby_used_%'` equals the number of `public` tables;
  - `standby refuses after use`: insert a row into `customers` on the standby, run `backup-now`, expect exit ≠ 0, the `has been used since the last copy` line, the fail ping, and the standby row still present. Repeat with `STANDBY_SYNC=on` explicitly: still refused;
  - `sign-in on standby marks used`: after a fresh load, insert a `session` row on the standby → `used_at` is not null;
  - `standby-clear allows the next load`: `standby-clear --yes` → `backup-now` succeeds → the inserted row is gone;
  - `failed load keeps previous standby`: put a corrupt file through `standby-load` (truncate a valid unlocked dump to half its size) → exit 1, `loaded_at` and counts unchanged;
  - `standby unreachable keeps backup`: `STANDBY_DATABASE_URL=postgres://x:y@standby:1/x` → the MinIO object exists, the log has `R2 backup was saved` and `standby out of date`, and the fail ping is sent;
  - `standby off skips with note`: empty `STANDBY_DATABASE_URL` → `Standby: off` and the ok ping;
  - `restored stack db has no standby triggers`: change a customer's name on the standby, then `standby-clear --yes`; stop app → `restore-from-standby --for-real` → Update the stack → healthy, the changed name is in the stack database, no `standby_used_%` triggers, and a sign-in on the stack works (a write succeeds).
- [ ] **Step 2:** Run the stack test. Expected: the new checks ❌.
- [ ] **Step 3:** Write `standby-guard.sql` (steps 1–2 and 4–5 as SQL, `:'app_version'` as a psql variable) and the scripts.
- [ ] **Step 4:** Rebuild and run the stack test. Expected: all ✅ (scenarios 1–10, Task 5 checks and Task 6 checks).
- [ ] **Step 5:** Commit `feat(docker): Neon standby load with used-standby guard`.

### Task 7: Image workflow on GitHub

**Files:**
- Create: `.github/workflows/docker-image.yml`

**Interfaces:**
- Triggers: tag push `v*` and `workflow_dispatch`. `permissions: contents: read, packages: write`. Concurrency per ref, no cancel. `runs-on: ubuntu-24.04-arm`, timeout 45 min.
- Steps (skill building-blocks §6):
  1. buildx build with `load: true`, tag `sparepartslk:test`, args `APP_VERSION` (tag or `sha-<7>`) and `GIT_SHA`, gha cache;
  2. "Check the tools inside" (versions, non-root user, image size into the step summary);
  3. `IMAGE=sparepartslk:test bash deploy/docker/test/stack-test.sh`, uploading its log on failure;
  4. push `ghcr.io/mrasika/sparepartslk:<tag or sha-7>` with `GITHUB_TOKEN`.

- [ ] **Step 1:** Write the workflow, following the example.
- [ ] **Step 2:** Push the branch, then run the workflow with the button on `feat/docker-stack`. Expected: green, with the summary listing every ✅ and the image `sha-<7>` in the repo's packages.
- [ ] **Step 3:** In GitHub, check that the package is **Private** (Packages → sparepartslk → Package settings).
- [ ] **Step 4:** Commit any fixes: `ci(docker): build, stack test and push the image`.

### Task 8: Vercel standby deploy workflow

**Files:**
- Create: `.github/workflows/deploy-standby.yml`

**Interfaces:**
- `workflow_dispatch` with a required input `version` (a release tag such as `v1.4.0`).
- Secrets: `STANDBY_VERCEL_TOKEN`, `STANDBY_VERCEL_PROJECT_ID`, `STANDBY_VERCEL_TEAM_SLUG`. They're new, so the current shop's secrets are never reused by mistake.
- Steps:
  1. check out `refs/tags/${{ inputs.version }}` (fail with `No such release` if it is missing);
  2. overwrite `vercel.json` in the workspace with `regions: ["iad1"]` (`jq`; the committed file keeps `syd1`);
  3. resolve the team ID, the same way as `deploy.yml`;
  4. `vercel deploy --prod --yes`;
  5. print the deployment URL into the step summary, with the line `Standby now runs <version>. Check it matches the stack's APP_VERSION.`
- The Vercel project's settings (`DATABASE_URL` = Neon direct, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` same as the stack, `CLIENT_IP_HEADER` empty, `SETUP_KEY` empty, domain added) are set by hand in Task 10, not by the workflow.

- [ ] **Step 1:** Write the workflow.
- [ ] **Step 2:** Dry run before Task 10: create a throwaway Vercel project, set `DATABASE_URL` to a Neon test branch loaded by `standby-now` from a test stack, and run the workflow with a test tag (`v0.0.0-standby-test`, pushed on the branch). Expected: green, the deployment runs in `iad1` (Vercel → Deployment → Functions region), sign-in works against the Neon data. Delete the test tag and project afterwards.
- [ ] **Step 3:** Commit `ci: deploy a release tag to the Vercel standby`.

### Task 9: Operator guide

**Files:**
- Create: `docs/operations/docker-hosting.md`

- [ ] **Step 1:** Write the guide, following the skill's `references/operations.md` sections 1–8 and `examples/washer-help/docs/15-docker-hosting.md`, for this app. Add the spec §5.8 sections:
  - "The standby (Neon) and how to read its nightly result";
  - "Switch to the standby" (spec §5.5 steps, numbered, exact button names: Portainer, GitHub "Deploy standby", Cloudflare DNS);
  - "Back to Oracle";
  - "Fire drill", ending with `standby-clear --yes` and a log table (date, version, result, who);
  - "Creating the database volume" (`docker volume create sparepartslk-<slug>-pgdata`, and why "remove stack" can't delete it);
  - "When to revisit Neon's plan" (database over about 300 MB, or Neon usage near 1 GB storage / 100 compute-hours).
  - "It's down" table rows: standby out of date · standby refused because it was used · Neon limit reached · Vercel deploy says `No such release`.
- [ ] **Step 2:** Check each step list against the scripts' real messages (grep every quoted `PROBLEM:` line in the guide against `deploy/docker/bin`). Expected: every quoted message exists.
- [ ] **Step 3:** Commit `docs: Docker hosting guide with Neon standby`.

### Task 10: First install and go-live checks (with the owner)

Not code: the owner types every secret, never in chat. Log each result in the guide.

- [ ] **Step 1:** On the server, `uname -m`. Expected: `aarch64`. If it isn't, stop: the image workflow must change to amd64 (skill `other-stacks.md`).
- [ ] **Step 2:** Merge `feat/docker-stack` → `development` → `main` by PR, then tag `v<next>` and wait for the image workflow to go green.
- [ ] **Step 3:** Guide §"Once per server" items not yet done, then §"Install a new company": tunnel, R2 bucket + lifecycle + scoped key, Neon project (`us-east-1`, Postgres 17, Free) and its **direct** address, settings file, external volume, Portainer stack. Expected: migrate exited 0, app healthy.
- [ ] **Step 4:** Setup screen → empty `SETUP_KEY` → Update the stack.
- [ ] **Step 5:** Jobs console: `backup-now`. Expected: the R2 object exists, the standby is loaded, counts match, the ok ping arrives. Then `restore-test`. Expected: counts match.
- [ ] **Step 6:** Vercel standby project (Task 8 interfaces) with the company domain verified, then the **fire drill** from the guide, shop closed: switch, sign in, open an invoice, switch back, `standby-clear --yes`. Expected: every step behaves as written; any difference is fixed in the guide before go-live.
- [ ] **Step 7:** Update the memory note `docker-customer-plan.md` with the release tag, install date and drill results. The company starts using the system.
