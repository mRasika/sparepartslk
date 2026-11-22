# Docker stack for a new company, with a Neon standby: design

- **Date:** 2026-11-22
- **Scope:** Steps 3 and 4 of the Docker plan (step 1 Better Auth, released 2026-11-07; step 2
  settings-only, released 2026-11-08). The Docker files, the stack, the jobs container (backups,
  standby copy, stock check), the automated stack test, the emergency copy of the app on Vercel, the
  operator guide and the first install.
- **Method:** the `docker-company-hosting` skill (Washer Help's proven setup). This document only
  records what is different for Sparepartslk and the decisions made with the owner. Where it is
  silent, follow the skill's rules.

## 1. Why

A new company (a spare parts shop, assumed in Sri Lanka) gets its own copy of Sparepartslk. The
current shop stays on Vercel + Supabase and is not touched by this work.

The owner's main concern is **data safety**. The app and its database run on the developer's own
Oracle server (cheap, under our control). A copy of the data is kept somewhere else, so that if the
Oracle server is lost the shop can keep working within minutes, on a copy no older than one day.

## 2. Decisions (made with the owner)

| Decision | Choice |
|---|---|
| Where it runs | One Docker stack on the existing Oracle server (region **us-ashburn**, Portainer, the laundry app runs there too) |
| Database | **Postgres 17 container in the stack, from day one** |
| Off-site backup | Nightly encrypted `pg_dump` to this company's own Cloudflare R2 bucket |
| Standby copy | Every backup is restored into a **Neon** database (Free plan, AWS **us-east-1**, Postgres **17**) |
| Emergency place to run the app | **Vercel**, region **iad1**, pointed at the Neon standby. Set up and tested before go-live |
| How much data may be lost | Up to one day (nightly). The backup frequency is a setting, so it can go to every few hours without code changes |
| Not now | Continuous WAL archiving / point-in-time recovery on our own server (possible later). Live replication to Neon (rejected: needs an open database port, Neon awake 24/7, and every release would have to change two databases) |

## 3. Goals, non-goals, anti-goals

**Goals**
- One private image (`ghcr.io/mrasika/sparepartslk:vX.Y.Z`) that any company can run. A new company
  is set up through the existing `/setup` screen.
- The stack starts, updates, rolls back and fails safely, as in the skill (rules 1–30).
- Every night: backup → R2 → **download it back** → unlock → load into Neon → compare row counts. A
  backup that can't be restored is noticed the next morning, not on the day it's needed.
- Switching the shop to Vercel + Neon is a short step list that has been practised once before
  go-live (the "fire drill"), then every 3 months together with the restore practice.
- A guide in plain words for the person running the server.

**Non-goals**
- Moving the current shop off Vercel/Supabase.
- Automatic switching to the standby. A person decides and runs the steps.
- Running the nightly stock check on Vercel during an emergency (it waits until the shop is back
  on Oracle).
- Multi-company in one database.

**Anti-goals (it would be a failure even if it technically works)**
- The nightly copy **overwrites a standby the shop is working on** (after a switch). Losing real
  sales this way is the worst outcome this design can produce, so it is guarded in code, not only in
  the guide (§5.4).
- A failed nightly load leaves Neon empty or half-loaded. Yesterday's copy must survive a failed
  load.
- Any database port open to the internet.
- Backups that silently stop. A missed night must raise an alert.

## 4. Constraints found in the project

- **Database driver:** `postgres` (postgres-js) with Drizzle (`src/server/db/client.ts`): `max: 4`,
  `prepare: false`, `idle_timeout: 20`. It **loses queries behind a transaction-mode pooler**. So
  the stack connects straight to `db`, and Vercel uses Neon's **direct** (unpooled) address, never
  the pooled one. Make the pool size a setting (default 4; the stack may use about 10).
- **Migrations:** Drizzle, `drizzle/*.sql` + `drizzle/meta/_journal.json`, applied list in
  `drizzle.__drizzle_migrations`. `drizzle-kit` is a dev tool. The image should run migrations with
  Drizzle's runtime migrator (`drizzle-orm/postgres-js/migrator`) from a small script, so the image
  doesn't need dev packages. The skill's rollback checks (database newer / disagree / unfinished)
  compare the journal with that table.
- **Migrations must run on plain Postgres.** They were written for Supabase but no longer use
  anything Supabase-only (checked 2026-11-22: no `auth.`/`storage.`/role grants. `0001_extras.sql`
  creates `pg_trgm` and turns on row-level security with no rules, which has no effect because the
  app owns the tables). The stack test proves it with a first install.
- **Stock check:** `public.reconcile_stock()` is SQL. On Supabase it runs from pg_cron
  (`supabase/cron.sql`, 02:00 Colombo). In the stack the jobs container calls it with `psql`. No
  HTTP cron endpoint is needed.
- **Already in the app (step 2):** `/api/health` (no DB, no login), `/setup` with `SETUP_KEY`,
  `CLIENT_IP_HEADER`, `NEXT_OUTPUT=standalone`, company name and logo from the database, build
  without a database. The logo is stored in the database (`logo` table), so **the database is the
  only state**: nothing else needs backing up or copying.
- **Tooling:** Node 24, pnpm 9.15.9 (`packageManager`), Next 16 (branch `chore/next-16`; the Docker
  work branches from `development` once that has landed), `pdfkit` fonts need
  `outputFileTracingIncludes` (already in `next.config.ts`). Check that the standalone output still
  contains them.
- **`vercel.json` pins `regions: ["syd1"]`** for the current shop. The standby project must run in
  `iad1`. The builder finds a way that doesn't change the current shop (e.g. a region override at
  deploy time, or the deploy step writing its own `vercel.json`).
- **Server chip:** Oracle Ampere, so **arm64** (the laundry app on the same server is built for
  arm64). Confirm with `uname -m` on the server before the first build.

## 5. Design

### 5.1 Stack (`deploy/docker/docker-compose.yml`)

As in the skill: `db` (postgres:17, pinned minor, named volume, healthcheck) → `migrate` (runs once,
safety copy first) → `app` (healthcheck on `/api/health`, `TZ: UTC`) · `jobs` (depends on `db`
only, `TZ: Asia/Colombo`) · `tunnel` (this company's own Cloudflare tunnel). No `ports:`.

**Volume protection:** the database volume must survive "remove stack". Use an **external** named
volume created once by the operator (`docker volume create sparepartslk-<slug>-pgdata`). The guide
says so in plain words.

Settings (`stack.env.example`), beyond the skill's usual lines:
- `CLIENT_IP_HEADER=cf-connecting-ip`, `SETUP_KEY` (first start only), `DB_POOL_MAX`.
- `BACKUP_SCHEDULE`: when backups run, a cron expression in company time, default nightly. One
  setting covers "every 3 hours during shop hours" later.
- `STANDBY_DATABASE_URL`: Neon's **direct** address. Empty = standby copy off (the backup still
  runs).
- `STANDBY_SYNC`: `on` / `off`. Turned `off` as the first step of a switch to Vercel.
- `BACKUP_PING_URL` (+ its failure URL): uptime monitor pinged only after the **whole chain**
  succeeded.

### 5.2 Jobs container schedule (company time)

| Time | Job |
|---|---|
| 02:00 | `reconcile-stock`: `select public.reconcile_stock()` |
| `BACKUP_SCHEDULE` (default 02:30) | `backup-and-standby` (§5.3) |

Console commands, as in the skill: `backup-now`, `restore-test`, `restore <file> --for-real`, plus
`standby-now`, `standby-status` and `restore-from-standby --for-real` (§5.5).

### 5.3 The nightly chain

1. `pg_dump` (client 17) of schemas `public` and `drizzle`, custom format, `--no-owner --no-acl`.
2. gpg AES256 with `BACKUP_PASSPHRASE` → R2 `daily/` (+ `monthly/` on the 1st). Lifecycle: daily
   35 days, monthly 400 days. The R2 key can only reach this company's bucket.
3. **Download that file back from R2**, unlock it. This proves R2, the file and the passphrase every
   night.
4. Load into Neon (§5.4).
5. Compare row counts, table by table, between the live database (taken at dump time) and Neon.
   Equal = done. Different = `PROBLEM:` + failure ping.
6. Success ping, with the backup size and the counts in the log.

If step 1–2 fails: no backup, failure ping. If step 3–5 fails: the backup in R2 still counts as
saved, but the log and the failure ping say the standby is **out of date** and why.

### 5.4 Loading Neon safely

- **All or nothing:** load in one transaction (`pg_restore --clean --if-exists --single-transaction
  --exit-on-error`, or equivalent). A failure leaves yesterday's copy in place.
- **`pg_trgm`** must exist on Neon before the load (`create extension if not exists pg_trgm`).
- **Never overwrite a standby that has been used.** After each load the job records a marker in Neon
  (e.g. a small table in its own schema, outside `public`/`drizzle`, holding the load time and a
  fingerprint of the data such as row counts plus the newest timestamps of the main tables). Before
  the next load it checks that Neon still matches that marker. If anything was written since the
  last load (the shop worked on the standby), it **refuses**, prints
  `PROBLEM: the standby has been used since the last copy — not overwriting it`, sends the failure
  ping, and keeps refusing until a person clears it with an explicit command. This is a code guard.
  `STANDBY_SYNC=off` is the procedural one. Exact mechanism: builder's call, but it must survive a
  mistaken `STANDBY_SYNC=on`.
- Watch the Neon Free limits: 1 GB storage per project (data plus 6 hours of history; each night's
  full reload adds roughly the database's size to history), 5 GB data out per month (the load is
  data *in*), 100 compute-hours per month (the standby is awake only minutes a night). The guide
  says to revisit the plan (Launch) when the database passes about 300 MB.

### 5.5 Switching to the standby and back

**Vercel standby project** (set up before go-live): its own Vercel project for this company, region
`iad1`, settings: `DATABASE_URL` = Neon direct address, `BETTER_AUTH_URL` = the company's normal
address, `BETTER_AUTH_SECRET` = **the same as the stack** (sessions are in the copied database, so
people may stay signed in), `CLIENT_IP_HEADER` **empty** (Vercel gives the visitor's address
itself), `SETUP_KEY` empty. The company's domain is added and verified in that Vercel project in
advance.

**Which version runs on Vercel:** the copy in Neon has the schema of the version running in the
stack. So the standby must run **the same release tag as the stack's `APP_VERSION`**. A GitHub
workflow "Deploy standby" (button, input = tag) deploys that tag to the standby project. My call:
deploy on demand (emergency and drills) rather than after every release, so the standby never runs
a newer version than its data. It takes a few minutes. The builder may also keep it pre-deployed
on the stack's version if that can be kept in step reliably.

**Switch (guide, numbered steps):** set `STANDBY_SYNC=off` → Update the stack (if the server is
still reachable) → run "Deploy standby" with the stack's version → in Cloudflare DNS, change the
company's record from the tunnel to Vercel's → check sign-in and today's last invoice → tell the
shop. Data since the last copy has to be re-entered from paper.

**Back to Oracle:** stack running with the app stopped → `restore-from-standby --for-real` (dumps
Neon with pg_dump 17, then the same safe load as `restore`: today's Oracle database renamed aside
first) → Update the stack → DNS record back to the tunnel → after checking: clear the
"standby used" marker, `STANDBY_SYNC=on`, and the next nightly copy runs normally.

**Fire drill** (before go-live, then every 3 months): the whole switch and back, with the shop
closed. Logged in the guide like the restore practice.

### 5.6 Build and release

As in the skill: `.github/workflows/docker-image.yml` on `ubuntu-24.04-arm`, tag `v*` + button,
full stack test before push, private ghcr package. Image tag = release tag. The current shop's
`deploy.yml` (Vercel, main/development) is unchanged.

### 5.7 Stack test additions (beyond the skill's scenarios)

A second `postgres:17` service in the test override stands in for Neon (R2 is replaced by a local
folder or a MinIO container: builder's call). Extra checks:
- the nightly chain loads the standby and counts match;
- a load that fails partway leaves the previous standby data intact;
- after a write to the standby, the next load **refuses** and says why, also with `STANDBY_SYNC=on`;
  after the clear command it loads again;
- `restore-from-standby --for-real` brings standby data back into the stack database;
- `reconcile-stock` runs from the jobs container and inserts an issue for a deliberately wrong
  quantity;
- `STANDBY_DATABASE_URL` empty → backup still runs, standby step skipped with a note.

### 5.8 Guide

`docs/operations/docker-hosting.md`, following the skill's `operations.md`, plus sections: "The
standby (Neon) and how to read its nightly result", "Switch to the standby", "Back to Oracle",
"Fire drill", and rows in the "it's down" table for: standby out of date, standby refused because it
was used, Neon limit reached.

### 5.9 First install (step 4)

Per the skill: tunnel, R2 bucket and key, settings file, external volume, Portainer stack, setup
screen, empty the key. Then before go-live: a real nightly chain (`backup-now`, which includes the
standby load), a `restore-test`, and the **fire drill**. The company starts using it only after all
three pass and are logged.

## 6. Approaches considered

| Approach | Outcome |
|---|---|
| Database on Neon first, move into the stack after a few months | Dropped. Two designs and a risky move. The standby gives the same off-server safety from day one |
| Database on Supabase Free | Dropped. Only 2 free projects, no undo window, and its `extensions` schema makes dumps awkward to restore elsewhere |
| **Database in the stack + nightly restore into Neon + Vercel emergency copy** | **Chosen.** Off-server copy, a nightly proof that backups restore, $0 running cost until an emergency |
| Live replication into Neon | Rejected: open database port, Neon awake 24/7 (~$20/mo), schema changes needed on both sides at every release |
| Continuous WAL archiving to R2 | Later, if losing up to a day (or a few hours) becomes too much |
| Second Oracle server as the emergency place | Rejected: more to maintain; Vercel already runs this code |

## 7. Left to the builder

- Exact script names and layout (follow the skill's examples), how R2 is faked in CI, the marker
  mechanism in §5.4 (within its rules), how the `iad1` region is set without touching the current
  shop's `syd1`, the default `DB_POOL_MAX` in the stack, pinned versions (postgres 17 minor,
  cloudflared, supercronic, rclone).
- Release-notes wording, and the order of guide sections.

## 8. Costs

Oracle server (existing, Pay As You Go, within free limits), R2 (free tier), Neon Free: **$0**.
Vercel: the standby project stays idle. Vercel's Hobby plan doesn't allow commercial use, so the
owner upgrades to Pro (~$20/month) when it actually serves the shop, or keeps Pro permanently.
That's the owner's call.
