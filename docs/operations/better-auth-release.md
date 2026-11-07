# Release: login on Better Auth

Moves the current shop's login from Supabase Auth to Better Auth (logins and sessions in our own
Postgres). Spec: `docs/superpowers/specs/2026-11-07-better-auth-design.md` §6.

The cloud database (`iuwjtvyyghefjkbiqiiq`) serves **both** Preview and Production. Migrations go
in through the Supabase MCP, with a hand-written drizzle tracking row, **before** the code.

## Before you start

- [ ] Tell staff: "After the update you'll be asked to sign in once more, with the **same password**."
- [ ] From step 4 until the production release, **don't create or change logins on Preview**. A login
      made on Preview exists only in Better Auth; one made on Production (old code) is picked up by the
      copy rerun in step 5.

## Steps

1. **Apply migration 0012** (adds 4 tables, changes nothing existing) through the MCP
   (`apply_migration`, name `0012_better_auth`, the SQL from `drizzle/0012_better_auth.sql`). Then the
   tracking row:

   ```sql
   insert into drizzle.__drizzle_migrations (hash, created_at)
   values ('26c6ba03d5f3f1be8f273f9a16d0db6a04075b0ae788a6711e7228e3968c27cc', 1794043128621);
   ```

   The hash is the sha256 of the file as stored in git (LF endings: `git show HEAD:drizzle/0012_better_auth.sql | sha256sum`);
   `created_at` is the journal's `when`. Check: `select count(*) from drizzle.__drizzle_migrations` → 13, and
   `user`, `session`, `account`, `verification` exist with RLS on.

2. **Copy the logins**: run `scripts/ops/copy-supabase-logins.sql` through the MCP (`execute_sql`).
   Check row: **profiles = users = accounts** (4 = 4 = 4 today).

3. **Add the secret** in Vercel (Preview **and** Production, the same value, as they share the database):
   `BETTER_AUTH_SECRET` = the output of `openssl rand -hex 32`. Keep a copy in the password manager.
   Don't set `BETTER_AUTH_URL` on Vercel (it reads the address from the request).

4. **Merge into `development`** → Preview runs Better Auth while Production still runs Supabase Auth,
   on the same data. On the Preview address:
   - [ ] sign in with a real login and its current password → dashboard;
   - [ ] open Sales, Stock, Payments, Users, Settings; sign out; `/dashboard` → `/login`;
   - [ ] turn a test login off on Users → its other browser is sent to `/login` on the next click.
         (Don't make new logins here; turn an existing one off and back on.)

5. **Just before the `development → main` release**, run the copy script **again** (carries over any
   password changed on Production since step 2). Same check row.

6. **Release to Production.** Every device is signed out once (old Supabase cookies are ignored) and
   people sign in with their same password. Check: sign in, open a few pages, sign out.

7. **After a day or two of normal use**, apply `0013_better_auth_cleanup` the same way as step 1
   (Task 8 of the plan). Before that, check
   `select count(*) from profiles p left join "user" u on u.id = p.user_id where u.id is null` → 0.

## Rollback

```bash
npx vercel@65.3.1 rollback <previous production deployment url>
```

Supabase Auth was never changed, so the old code works at once. Only a password changed under Better
Auth goes back to its old value. **Don't apply 0013 while rollback may still be wanted**: the old
code reads `profiles.signed_out_at`, which 0013 drops.
