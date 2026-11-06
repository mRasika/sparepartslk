# Dashboard reload loop: postgres-js pipelining through the Supabase transaction pooler

**Status (2026-10-27):** fixed on Preview, **not yet on Production**. See "Steps to finish".

## Symptom

- On Vercel, the dashboard showed the daily target card. Then the page reloaded again and again while Sales & profit was still loading, for a signed-in admin.
- Production was rolled back on 2026-10-26 because of this.
- It never happened locally, in `next start`, or in the e2e tests.

## What was really happening

1. **The server never finished the dashboard.** Vercel logged `GET /dashboard … Task timed out after 300 seconds`. The sign-in POST timed out too, because it renders the dashboard.
2. **The browser received part of the page and then nothing.** The target card arrived after about 1.3 s, and Sales & profit never came. When the 300 s limit cut the page load off, Next.js reloaded the page, and the reload hung again. That's the loop.
3. **Temporary tracing (`[db-trace]`) showed which queries never came back.** Every one of them had been written to a connection right behind another query that hadn't been answered yet.
   - **First trace:** the Sales trend and top-sellers queries hung.
   - **Second trace:** the `invoice_drafts` count, written 1 ms behind the `parts` count on the same connection, hung. The `parts` count was answered.
4. **The database never saw those queries.**
   - While a load was stuck, `pg_stat_activity` showed nothing running and no locks.
   - The same queries took under 1 ms when timed directly in the database (`EXPLAIN ANALYZE`).

## Cause

postgres-js **pipelines**: it writes the next query on a connection before the previous one is answered. This is on by default (`max_pipeline: 100`). With `prepare: false`, a query with parameters takes two round trips (Parse/Describe/Flush, then Bind/Execute/Sync). When such a query was pipelined behind another, **Supavisor in transaction mode (port 6543)** sometimes never answered it.

| Where | Pipelining happens? | Hang? | Why |
|---|---|---|---|
| Locally | Yes | No | No pooler |
| This PC → cloud pooler | Rarely | No | About 150 ms per round trip, so queries rarely pile up on one connection |
| Vercel (Sydney) → pooler | Often | Yes | About 1 ms per round trip; a dashboard load opens about 10 connections and pipelines on them |

The sales target release didn't introduce the bug. It made it likely: the dashboard runs about twice as many queries at once (target card + Sales & profit).

## Fix

**Point `DATABASE_URL` on Vercel at Supavisor's *session* pooler:** same host, user and password, **port 5432** instead of 6543. In session mode each client connection has its own server connection, so pipelining is safe.

- Keep `max: 4` in `src/server/db/client.ts`. Session mode caps the total number of client connections, and each Vercel instance holds up to `max`.
- Keep `idle_timeout: 20`, `max_lifetime: 5 min` and `connect_timeout: 10` so idle connections are given back quickly.

### What did *not* work (don't retry)

- **`max_pipeline: 0`** stops pipelining but breaks every `db.transaction` in postgres-js 3.4.9 (`UNSAFE_TRANSACTION: Only use sql.begin, sql.reserved or max: 1`). The `begin` reserve hook only runs when the connection may pipeline. 147 unit tests failed.
- **Lowering `max` on the transaction pooler** (PR #22) made it worse: fewer connections means more pipelining per connection, and the whole dashboard hung.
- **Idle/lifetime timeouts alone** (PR #21) didn't help: the hung queries were on brand-new connections, not stale ones.

### Alternative if we ever need the transaction pooler again

Switch the driver to node-postgres (`pg`) with `drizzle-orm/node-postgres`. It never pipelines.

- **Cost:** the client setup, plus about 18 `db.execute` call sites, because `pg` returns `{ rows }` instead of an array.
- **Verify:** run the full unit and e2e suites, then a preview deploy with the trace on.

## Steps to finish (before the next production release)

1. **Switch Production's `DATABASE_URL` to the session pooler.** Preview is already done.

   ```sh
   # list (names/targets only)
   npx vercel@65.3.1 env ls --scope hobby-daa6 --project prj_qQMSIB0qLmOFJ2JXDtse84LKfdND
   # Production entry is separate from Preview's; update only it
   grep -E '^DATABASE_URL=' .env.cloud.local | cut -d= -f2- | tr -d '"\r\n' | sed 's#:6543/#:5432/#' \
     | npx vercel@65.3.1 env update DATABASE_URL --environment production --sensitive --yes \
         --scope hobby-daa6 --project prj_qQMSIB0qLmOFJ2JXDtse84LKfdND
   ```

   Check the URL first with a few read-only selects through port 5432 (this worked on 2026-10-27).

2. **Remove the temporary tracing:**
   - delete `src/server/db/trace.ts`;
   - remove `traced(...)` from `dashboard/page.tsx`, `sales-analytics.ts` and `sales-targets.ts`;
   - remove the `debug` option in `client.ts`.

3. **Fix the comment on `max: 4` in `src/server/db/client.ts`.** It says the pooler holds 5 connections, which was a wrong theory. The real reason is the session-mode connection cap.

4. **Merge `development` → `main`.**

5. **Promote and check the live site.** Production was rolled back, so new production deployments aren't promoted automatically:

   ```sh
   npx vercel@65.3.1 promote <new-production-deployment-url> --scope hobby-daa6
   npx vercel@65.3.1 inspect sparepartslk.vercel.app --scope hobby-daa6   # confirm the live deployment id
   ```

6. **Check the live dashboard as admin:**
   - it loads in a few seconds and doesn't reload;
   - Payments → Outstanding / Most overdue and the Stock filters work;
   - the daily report PDF downloads.

## Related open items

- **A failed query crashed the whole server process.** A cancelled `parts` query (statement timeout) caused `Unhandled Rejection … exited with status 128`. It's worth hardening; it isn't related to the loop.
- **Vercel Authentication (Deployment Protection) is off for the preview.** The user turned it off for debugging on 2026-10-27; turn it back on.
- **The preview and production share one Supabase database.** Anything changed on the preview changes real data.

## Evidence trail

- **PRs:** #20 (same-page link fix), #21 (timeouts + tracing), #22 (`max: 4`).
- **Vercel CLI:** `npx vercel@65.3.1 logs --scope hobby-daa6 -p prj_qQMSIB0qLmOFJ2JXDtse84LKfdND --json`. Runtime logs on Hobby only go back about 30 minutes; filter with `grep db-trace`.
- **Fixed preview deployment:** `dpl_GBwKiQWhKRdzt8WDA2rQM5huZHzH`. 98 of 98 traced calls ended, the slowest in 159 ms.
