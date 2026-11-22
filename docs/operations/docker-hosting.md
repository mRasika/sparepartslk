# Running a company's copy of Sparepartslk on our own server (Docker + Portainer + Neon standby)

This guide is for the person running the Oracle server. It explains how a new company gets its own copy
of Sparepartslk, how to put a new version on it, how to go back, how the backups and the **Neon
standby** work, and what to do when something goes wrong, including moving the shop to the standby if
the server is lost.

The current shop runs on Vercel + Supabase and is not affected by anything here.

Design: [docs/superpowers/specs/2026-11-22-docker-stack-design.md](../superpowers/specs/2026-11-22-docker-stack-design.md).

---

## 1. What you get

Each company is one **stack** in Portainer, made of five containers:

| Container | What it does | You see it as |
|---|---|---|
| **db** | The company's own database (PostgreSQL 17) | always running |
| **migrate** | At every deploy: makes a safety copy of the database, updates it for the new version, then stops | "exited · code 0" = fine |
| **app** | The website | "healthy" = fine |
| **jobs** | 02:00 stock check, the nightly backup + standby copy (02:30, Sri Lanka time), and the restore commands | always running |
| **tunnel** | The company's Cloudflare tunnel: gives the website its address and HTTPS | always running |

Outside the server:

| Where | What |
|---|---|
| **Cloudflare R2** (the company's own bucket) | Every night's backup, locked with `BACKUP_PASSPHRASE`: `daily/` 35 days, `monthly/` 13 months |
| **Neon** (the company's own project, Free plan, AWS us-east-1, Postgres 17) | The **standby**: a copy of the data, reloaded from that night's backup every night |
| **Vercel** (the company's standby project, region iad1) | An emergency copy of the app, pointed at the standby. Only used when the server is lost (section 9) |

- **No ports are opened on the server.** People reach the app only through Cloudflare.
- **The database volume lives outside the stack** (`sparepartslk-<slug>-pgdata`). "Remove stack" in
  Portainer can't delete it (section 3.4).
- Everything comes back by itself after a crash or a server restart.
- The app is built by GitHub and stored privately at `ghcr.io/mrasika/sparepartslk`. The server only
  downloads it; it never builds anything.

**How much data can be lost:** up to everything since the last backup (one night with the default
schedule). `BACKUP_SCHEDULE` can run it more often (section 8.4).

---

## 2. Once per server

The Oracle server already runs the laundry stacks, so these are probably done. Check each:

1. **Portainer is locked:** reachable only through Cloudflare Access on its **exact** hostname (never a
   `*.<domain>` wildcard: it puts a Cloudflare login in front of every company's site), and its ports
   9443/8000 are removed from **Oracle → Networking → VCN → Security Lists**.
2. **Oracle never stops the server:** **Oracle Console → Billing** says **Pay As You Go**.
3. **Portainer can download our app:** **Portainer → Registries** has `ghcr.io` with a GitHub token that
   has only `read:packages` (expiry date in your calendar). Check once that **GitHub → Packages →
   sparepartslk** says **Private**.
4. **The chip:** SSH to the server, run `uname -m`. It must say `aarch64` (the image is built for ARM).

---

## 3. Install a new company (once per company)

You need: the company's short name (e.g. `newshop`: small letters, no spaces), its web address (on a
domain in your Cloudflare account), and the newest version with a **green tick** in **GitHub → Actions
→ Docker image**.

In short: tunnel (3.1) → R2 bucket (3.2) → Neon standby (3.3) → settings file (3.4) → volume + stack
(3.5) → setup screen → empty `SETUP_KEY` → before go-live checks (3.6).

### 3.1 Cloudflare tunnel (the address and HTTPS)
1. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared.** Name: `sparepartslk-newshop`.
2. Copy the long token after `--token` (you don't install anything).
3. **Public hostname** (or **Published application routes**) on **this tunnel**: the company's address,
   Service `http://app:3000`. Cloudflare makes the DNS record by itself. A new address can take a few
   minutes to work.
4. **Don't** add a Cloudflare Access application for this address: staff must reach the app's own login.

### 3.2 Cloudflare R2 (the nightly off-site backup)
1. **Cloudflare → R2 → Create bucket** `sparepartslk-newshop-backup`.
2. **Settings → Object lifecycle rules:** delete prefix `daily/` after **35 days**, prefix `monthly/`
   after **400 days**.
3. **R2 → Manage API tokens → Create API token:** **Object Read & Write**, **this bucket only**. Copy the
   Access Key ID, the Secret Access Key and your Account ID.

### 3.3 Neon (the standby)
1. **Neon → New project.** Name `sparepartslk-newshop`, **Postgres 17** (not the default 18: the
   backup tools are version 17), region **AWS US East 1 (N. Virginia)**, Free plan.
2. **Connect → turn "Connection pooling" OFF** and copy the address (it has no `-pooler` in it). Add
   `?sslmode=require` at the end if it isn't there. This is `STANDBY_DATABASE_URL`. **Never use the
   pooled address**: the app loses queries behind it.

### 3.4 The settings file
1. Copy [`deploy/docker/stack.env.example`](../../deploy/docker/stack.env.example) to
   **`.env.newshop.stack.local`** in the project folder (git ignores it) and fill it in. Every line has
   a short explanation. Make each secret with `openssl rand -hex 32` (a new one for every line and
   every company):

   | Line | What to put |
   |---|---|
   | `APP_VERSION` | The newest version with a green tick, e.g. `v1.0.0` |
   | `COMPANY_SLUG`, `PGDATA_VOLUME` | `newshop`, `sparepartslk-newshop-pgdata` |
   | `BETTER_AUTH_URL` | `https://<address>` (no slash at the end) |
   | `BETTER_AUTH_SECRET`, `DB_PASSWORD`, `BACKUP_PASSPHRASE` | Each a new `openssl rand -hex 32` |
   | `SETUP_KEY` | `openssl rand -hex 24`: typed once on the setup screen, then emptied |
   | `TUNNEL_TOKEN` | From 3.1 |
   | `R2_…` | From 3.2 |
   | `STANDBY_DATABASE_URL` | From 3.3 |
   | `BACKUP_PING_URL`, `BACKUP_PING_FAIL_URL` | Optional, section 3.6 |

2. **`BACKUP_PASSPHRASE` is the key to every backup.** Keep the filled-in file in your password
   manager, not only on the server. Never paste the values into a chat or an email.

### 3.5 Start it in Portainer
1. **Make the database volume** (once): SSH to the server and run
   `docker volume create sparepartslk-newshop-pgdata`. The database lives there. Because it is made
   outside the stack, **"Remove stack" can't delete it**. To really delete a company's data you would
   have to run `docker volume rm` yourself.
2. **Portainer → Stacks → Add stack.** Name `sparepartslk-newshop`, **Web editor**, paste the whole of
   [`deploy/docker/docker-compose.yml`](../../deploy/docker/docker-compose.yml).
3. **Environment variables → Load variables from .env file** → your filled-in file. **Deploy the stack.**
4. Wait until `…-migrate-1` shows **exited · code 0** and `…-app-1` shows **healthy**. The migrate log
   ends with *"Empty database: open the website to set up the company (the setup screen)."*
5. Open the address: **Set up**. Type the `SETUP_KEY`, the business name and the owner's name, email
   and password. The owner is signed in and lands on the dashboard.
   - It says **Setup is locked**? `SETUP_KEY` is empty or shorter than 24 characters: add it and
     **Update the stack**.
6. **Close the key:** Environment variables → empty `SETUP_KEY` → **Update the stack**.

### 3.6 Before the company goes live (all three, logged in section 8.3)
1. **A real backup and standby copy:** jobs **Console** (section 8) → `backup-now`. It must end with
   *"Finished OK"*, show *"R2 backup was saved"* and *"Standby: same rows as the live database in all …
   tables."* Check the file in the R2 bucket.
2. **A restore practice:** `restore-test` → *"Restore practice PASSED"*.
3. **The fire drill** (section 10): the whole switch to the standby and back.
4. Optional but recommended, in your uptime monitor (uptime-kuma): an HTTP monitor on
   `https://<address>/api/health` (answers `ok`), and a **Push** monitor with a 25-hour heartbeat whose
   address goes in `BACKUP_PING_URL` (and its failure address, if it has one, in `BACKUP_PING_FAIL_URL`).

---

## 4. A new version (every release)

After closing time.

1. Wait until **GitHub → Actions → Docker image** shows a **green tick** for the new tag. Red = don't
   update.
2. **Portainer → Stacks → the stack → Editor** → change **APP_VERSION** → turn on **Re-pull image and
   redeploy** → **Update the stack**.
3. `migrate` → **exited · code 0**, then `app` → **healthy**.
4. Five-minute check: sign in, open the dashboard, a part, an invoice.

When the release notes say "paste the new stack file", paste the new `docker-compose.yml` first. Your
settings stay.

## 5. Going back (rollback)

Same as an update, with the old number. `migrate` says *"The database is newer than this version (a
rollback): the database is left as it is."* That is normal. If it says *"The database and this version
disagree"*, put back the version that worked and ask the developer.

## 6. When an update fails

`migrate` shows **exited · code 1** and its log says *"The database update failed"*. **The website is
down** (Docker stops the old app first), so act straight away:
1. Put **APP_VERSION** back to the previous version → **Update the stack**. The site is back in about a
   minute. The failed update changed nothing: the database is exactly as it was.
2. Send the developer the `migrate` log.

---

## 7. The standby (Neon): how to read its nightly result

After every backup, the jobs container downloads that backup **back** from R2, unlocks it, loads it into
Neon (all or nothing) and compares the rows of every table with the live database. So every night proves
that the backup can really be restored.

In the **jobs → Logs** after a good night:
- *"R2 backup was saved: daily/…"*
- *"Standby loaded (version v…)."* and *"Standby: same rows as the live database in all N tables."*
- *"Finished OK"*, and the uptime monitor gets its ok ping.

Anytime: jobs **Console** → `standby-status` shows when the standby was last loaded, from which version,
whether it has been **used** since, and its counts next to the live ones.

**The guard:** the moment anything is written to the standby (a sale, an edit, even someone signing
in), it is marked **used**. From then on the nightly copy **refuses to overwrite it** and says *"the
standby has been used since the last copy"* until someone runs `standby-clear --yes`. This protects
sales made on the standby during an emergency. **Only run `standby-clear --yes`** after a fire drill, or
after the standby's data has been brought back to the server (section 9.2).

---

## 8. Backups and restoring

The jobs **Console:** **Portainer → Containers → `…-jobs-1` → Console** → Command `/bin/sh` →
**Connect**. Commands:

| Command | What it does |
|---|---|
| `backup-now` | A backup now, then the standby copy |
| `restore-test` | Restore practice: loads the newest backup into a throw-away database, changes nothing |
| `restore <file> --for-real` | A real restore (8.2) |
| `standby-status` | The standby's state (section 7) |
| `standby-now` | Loads the newest R2 backup into the standby now (without a new backup) |
| `standby-clear --yes` | Clears the "used" mark (section 7: only when the standby's data is safe) |
| `restore-from-standby --for-real` | Back to the server after working on the standby (9.2) |

### 8.1 What is saved, and where
| Copy | When | Where | Protects against |
|---|---|---|---|
| Safety copy | Before every update | Inside the stack (`backups` volume), the newest 5 | A bad update |
| Nightly backup | `BACKUP_SCHEDULE` (02:30) | R2: `daily/` 35 days, `monthly/` 13 months | The server lost; a mistake noticed days later |
| Standby | Right after each backup | Neon | The server lost: the shop keeps working within minutes (section 9) |

The standby holds only **last night's** copy. A mistake made today and noticed next week is in the
standby too. Going back further is what the R2 backups are for.

### 8.2 A real restore (only after talking to the developer)
1. **Containers → `…-app-1` → Stop.**
2. jobs **Console** → one of: `restore newest --for-real` · `restore daily/<file>.dump.gpg --for-real` ·
   `ls /backups`, then `restore /backups/pre-deploy_<date>.dump --for-real`.
3. Today's database is **kept aside** as `sparepartslk_before_restore_<date>`. If loading fails it is put
   back by itself.
4. **Update the stack** (APP_VERSION as it is). Don't just start the app container.
5. After a few days, the developer deletes the kept database in the `db` Console:
   `psql -U sparepartslk -d postgres -c 'drop database "sparepartslk_before_restore_<date>"'`.

### 8.3 Practice log (before go-live, then every 3 months)
Restore practice (`restore-test`) and fire drill (section 10).

| Date | Company · version | What | Result | By |
|---|---|---|---|---|
| | | | | |

### 8.4 Backing up more often
`BACKUP_SCHEDULE` is a cron line in Sri Lanka time. Nightly: `30 2 * * *`. Also every 3 hours during the
day: `30 2,9,12,15,18,21 * * *`. Change it in Environment variables → **Update the stack**. Each run also
reloads the standby. **Watch Neon's limits** (Neon → Billing → Usage): the Free plan has 1 GB storage
(data plus 6 hours of history; each load adds about the database's size to history), 5 GB data out per
month and 100 compute-hours per month. **When the database passes about 300 MB, or usage gets near a
limit, move the standby project to Neon's Launch plan** (pay as you go).

---

## 9. The server is lost: switch the shop to the standby

Do this only when the server (or its database) is really gone or broken for hours, not for a short blip.
Sales made since the last backup have to be re-entered from paper.

### 9.1 Switch to the standby
1. **Stop the nightly copy** (if Portainer still answers): Environment variables → `STANDBY_SYNC=off` →
   **Update the stack**. (If the server is gone, skip this: the guard protects the standby anyway.)
2. **Which version:** the `APP_VERSION` from the company's settings file (password manager).
3. **GitHub → Actions → Deploy standby → Run workflow** → version = that `APP_VERSION` → wait for the
   green tick (a few minutes). The summary says *"Standby now runs v…"*.
4. **Vercel:** if the standby project is on the Hobby plan, upgrade it to **Pro** now (Hobby doesn't
   allow commercial use).
5. **Cloudflare → the domain → DNS → Records** → the company's record: change it from the tunnel
   (`<id>.cfargotunnel.com`) to Vercel's (`cname.vercel-dns.com`), **DNS only** (grey cloud).
6. Open the address: sign in, check today's last invoice. Tell the shop which sales to re-enter.

### 9.2 Back to the server
1. The stack runs again on a working server (a new server: section 2 and section 3 with the **same**
   settings file, **don't fill in the setup screen**). Keep `STANDBY_SYNC=off`.
2. After closing time: **Containers → `…-app-1` → Stop.**
3. jobs **Console** → `restore-from-standby --for-real`. It copies the standby's data, keeps the
   server's old database aside, and loads the standby's data as the real database.
4. **Update the stack.** `migrate` → code 0, `app` → healthy.
5. **Cloudflare DNS:** change the record back to the tunnel (`<id>.cfargotunnel.com`, proxied). Check
   the site, sign in, check the last invoice made on the standby is there.
6. jobs **Console** → `standby-clear --yes` → Environment variables → `STANDBY_SYNC=on` → **Update the
   stack** → `backup-now`. It must end with *"Finished OK"*.
7. Vercel can go back to Hobby.

---

## 10. The fire drill (before go-live, then every 3 months)

The whole of section 9, for practice, with the shop **closed**:
1. Section 9.1 steps 1, 3, 5 (no Pro upgrade needed for a short drill), then sign in on the standby and
   open an invoice. **Don't** create real data.
2. Section 9.1 step 5 backwards (DNS back to the tunnel), `STANDBY_SYNC=on`, Update the stack. **Skip
   `restore-from-standby`**: nothing real happened on the standby.
3. Signing in on the standby marked it **used** (a session row). Run `standby-clear --yes`, then
   `backup-now` → *"Finished OK"*.
4. Write the result in the practice log (8.3). Anything that didn't go as written: fix this guide.

---

## 11. It's down: what now?

| What you see | What to do |
|---|---|
| The website doesn't open | Portainer → the stack: is `tunnel` running, is `app` healthy? Restart the one that isn't. Is the server up? |
| A **Cloudflare login** instead of the app | An Access application covers it (usually a wildcard): use Portainer's exact address, or add a **Bypass · Everyone** application for this address |
| **502**, tunnel log shows no new lines | The DNS record points at another tunnel: it must be **this** tunnel's `<id>.cfargotunnel.com`. Wait a few minutes after a change |
| **502**, tunnel log says `Unable to reach the origin service` | Is `app` healthy? Route `http://app:3000`? jobs Console: `node -e "fetch('http://app:3000/api/health').then(r=>r.text()).then(console.log)"` must print `ok` |
| **502**, `app` healthy, tunnel says `lookup app … no such host` | The app container was changed on its own. **Containers → `…-app-1` → Stop → Remove**, then **Update the stack** |
| `app` is **unhealthy** | Logs → Restart. Still bad → previous version (section 5), tell the developer |
| `migrate` red after an update | Section 6 |
| Can't download the image | GitHub token expired: new token, update the registry in Portainer |
| The monitor says a backup was missed, or the log says *"No backup was saved"* | jobs → Logs: the line starting `PROBLEM:` says why (R2 settings, internet…). Fix it, then `backup-now` |
| Log says *"The R2 backup was saved (…), but the standby is out of date"* | The backup is fine; the standby kept its previous copy. The reason follows. Neon down or its limit reached → check Neon's dashboard (section 8.4), then `standby-now` |
| Log says *"the standby has been used since the last copy"* | Someone wrote to the standby. Was it a fire drill or a finished emergency (data brought back)? Then `standby-clear --yes`. If you don't know why, **don't clear it**: `standby-status`, and ask the developer |
| `Deploy standby` says *"No such release"* | The version typed isn't a release tag. Use the exact `APP_VERSION` from the settings file, e.g. `v1.4.0` |
| `restore-test` can't unlock the backup | `BACKUP_PASSPHRASE` doesn't match the one the backup was made with. Tell the developer the same day |
| The server is lost | Section 9 |

---

## 12. Regular jobs

| How often | What |
|---|---|
| Every release | Section 4, after closing time, then the five-minute check |
| Every month | **Portainer → Images → Remove unused**; glance at Neon's usage page |
| Every 3 months | Restore practice + fire drill (section 10), logged in 8.3 |
| Before the GitHub token expires | New token, update the registry in Portainer |

---

## 13. For the developer

- Files: `Dockerfile`, `deploy/docker/` (stack file, settings template, `bin/` scripts, `lib/` standby
  SQL, `migrator/` database update, `test/` stack test), `.github/workflows/docker-image.yml`,
  `.github/workflows/deploy-standby.yml`.
- `deploy/docker/test/stack-test.sh <image>` runs the whole stack (install, disagree, update, setup,
  rollback, broken update, crash, stock check, backup, restore, standby guard, back from the standby). It
  runs on every image build on GitHub's ARM machine; locally on Docker Desktop in about 6 minutes.
- Standby bookkeeping: schema `standby_meta` on Neon only (`sync` row + `mark_used()` trigger function,
  `standby_used_<table>` triggers). Never part of a backup; `restore-from-standby` leaves the triggers out.
- Repository secrets for `deploy-standby.yml`: `STANDBY_VERCEL_TOKEN`, `STANDBY_VERCEL_PROJECT_ID`,
  `STANDBY_VERCEL_TEAM_SLUG`.
