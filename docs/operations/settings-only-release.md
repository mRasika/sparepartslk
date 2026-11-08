# Release: settings-only app (company name, logo in the database, setup screen)

Spec: `docs/superpowers/specs/2026-11-07-settings-only-design.md` §6.

The cloud database (`iuwjtvyyghefjkbiqiiq`) serves **both** Preview and Production. The migration
goes in through the Supabase MCP, with a hand-written drizzle tracking row, **before** the code.

## Steps

1. **Apply migration 0013** (adds the `logo` table with RLS; changes nothing existing) through the MCP
   (`apply_migration`, name `0013_logo`, the SQL from `drizzle/0013_logo.sql`), with the tracking row
   in the same migration:

   ```sql
   insert into drizzle.__drizzle_migrations (hash, created_at)
   values ('26b15337a5d62d76bd18f2aa46845a643bc1331928b9bd6a953039deaeec9be2', 1794054676019);
   ```

   Hash = sha256 of `git show HEAD:drizzle/0013_logo.sql` (LF endings); `created_at` = the journal's
   `when`. Check: `select count(*) from drizzle.__drizzle_migrations` → 14, and `logo` exists with RLS on.

2. **Merge into `development`**, then check Preview:
   - [ ] the sidebar and browser tab show the shop's business name;
   - [ ] `/setup` goes to `/login` (a company exists);
   - [ ] `/api/health` answers `ok`;
   - [ ] the current logo still shows on Settings and on an invoice's print page (still its Supabase link);
   - [ ] **don't upload a new logo on Preview**: Preview and Production share the database, so it would
         change Production's logo too.

3. **Release to Production.** Then the owner opens **Settings**, uploads the logo again, clicks
   **Save settings**, and checks it on an invoice's print page.

4. **After the logo is re-uploaded**, remove `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SUPABASE_SERVICE_ROLE_KEY` from Vercel (Preview and Production). Nothing reads them any more.

Don't set `SETUP_KEY` or `CLIENT_IP_HEADER` on Vercel. They are for Docker companies only.

## Rollback

```bash
npx vercel@65.3.1 rollback <previous production deployment url>
```

The old code reads `settings.logo_url`. While it still holds the Supabase link, the old code shows the
logo as before. Once the owner has uploaded the logo again, it holds `/api/logo?v=…`, which the old code
can't show: the logo is missing until you roll forward. The `logo` table is harmless to the old code.
