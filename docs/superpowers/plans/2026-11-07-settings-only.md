# Settings-only App and Setup Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One image any company can run: the company name from Settings, the logo in Postgres, a one-time `/setup` screen for an empty database, `/api/health`, and the client-IP setting for the Docker tunnel.

**Architecture:**
- **Name:** pages get the business name through a cached reader that tolerates a missing settings row; services read it fresh.
- **Logo:** a one-row `logo` table, served by an authenticated `/api/logo` route. `settings.logo_url` keeps holding the URL the pages show.
- **Setup:** a service that checks a key and creates the company inside an advisory-locked transaction, with a public page and a server action in front of it.

**Tech Stack:** Next 15.5 App Router, Drizzle 0.45 + postgres-js, Better Auth (step 1), zod 4, Vitest on real Postgres, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-settings-only-design.md`

## Global Constraints

- Fallback name: `"Sparepartslk"`. Titles: `<name>`, `Sign in · <name>`, `Forgot password · <name>`. Email subjects: `Your <name> password code`, `Your <name> password was changed`.
- Logo types: `image/png`, `image/jpeg`, `image/webp`; at most 1 MB (1024 × 1024 bytes); first bytes must match the type. URL form `/api/logo?v=<updated_at ms>`. Response headers: stored `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=31536000, immutable`.
- `settings.logoUrl` accepts only `null`, `/api/logo?v=<digits>`, or an `https://` URL.
- `SETUP_KEY`: required, at least 24 characters. Setup limit: `setup-ip/<ip>`, 10 per HOUR. Advisory lock id `72026110`.
- Setup copy, exactly:
  - `"Setup is locked. Put a SETUP_KEY of at least 24 characters in the stack settings, then reload this page."`
  - `"The setup key is wrong."`
  - `"This system is already set up. Sign in instead."`
  - `"Too many tries. Wait a while and try again."`
- "A company exists" = at least one row in `profiles`.
- `/api/health`: body `ok`, `text/plain`, `Cache-Control: no-store`, no login, no database.
- `next.config.ts`:
  - `output: "standalone"` only when `NEXT_OUTPUT === "standalone"`;
  - `experimental.serverActions.bodySizeLimit: "2mb"`;
  - safety headers exactly as spec §5.
- `CLIENT_IP_HEADER`: when set and present on the request, its value is the IP; otherwise today's rules.
- Migration `0013_logo` only adds the `logo` table, with `ENABLE ROW LEVEL SECURITY` appended by hand (like 0012). The step 1 cleanup becomes `0014`.
- Remove `@supabase/supabase-js`, `src/server/supabase.ts` and every `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` read.
- **Edit files that contain backslashes (`src/middleware.ts` matcher, regexes) with the Edit/Write tool, never a shell heredoc.** Heredocs drop backslashes on this machine.

## Review Focus

1. **A brand-new database with no settings row:** every page that reads the business name (the root layout title, `/login`, `/setup`) must render with "Sparepartslk", not crash. Test in Task 1 (`findSettings` null → `displayName("")`) and Task 5 (e2e on an empty database).
2. **A setup key pasted with a trailing space or newline:** surrounding whitespace is trimmed on both sides before comparing, so it is accepted. Test in Task 4.
3. **An owner email typed with capitals:** stored lowercase, and the owner can sign in with any capitalisation. Test in Task 4.
4. **An old logo link with a stale `?v=`:** it still returns the current logo (the route ignores `v`). Test in Task 2.
5. **The middleware matcher:** it lets `/setup` and `/api/health` through without a session, but still guards `/api/logo` and `/setupx`. Test in Task 3 (health) and Task 5 (setup), in `tests/services/middleware.test.ts`.

---

### Task 1: Company name from Settings

**Files:**
- Create: `src/lib/business-name.ts`
- Modify:
  - `src/server/services/settings.ts` (add `findSettings`);
  - `src/server/cached.ts` (add `cachedBusinessName`);
  - `src/app/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/forgot-password/page.tsx`;
  - `src/app/(app)/layout.tsx`, `src/components/nav/sidebar.tsx`;
  - `src/server/services/password-reset.ts`.
- Test: `tests/lib/business-name.test.ts`, `tests/services/settings.test.ts`, `tests/services/password-reset.test.ts`

**Interfaces:**
- Produces:
  - `displayName(saved: string | null | undefined): string` — the trimmed name, or `"Sparepartslk"` when empty or blank.
  - `findSettings(tx?: Executor): Promise<Settings | null>`. `getSettings` keeps throwing when the row is missing.
  - `cachedBusinessName(): Promise<string>`: `unstable_cache` with tag `settings` and revalidate 600, returning `displayName((await findSettings())?.businessName)`.
  - `Sidebar` gets a new prop `businessName: string`.

- [ ] **Step 1: Write the failing tests**
  - `tests/lib/business-name.test.ts`: `displayName("  Silva Motors ")` is `"Silva Motors"`; `displayName("")`, `displayName("   ")`, `displayName(null)` and `displayName(undefined)` are each `"Sparepartslk"`.
  - `tests/services/settings.test.ts`: `findSettings()` returns the row after `resetDb()`, and returns `null` after `db.delete(settings)`.
  - `tests/services/password-reset.test.ts`, in "asking for a code":
    - with `business_name` updated to `"Silva Motors"`, the code email's subject is `"Your Silva Motors password code"`;
    - with it empty (the default), it is `"Your Sparepartslk password code"`.
    - In "using the code": the notice's subject is `"Your Silva Motors password was changed"` when the name is set.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/lib/business-name.test.ts tests/services/settings.test.ts tests/services/password-reset.test.ts`
Expected: FAIL (module missing, `findSettings` not exported, subjects still say Sparepartslk).

- [ ] **Step 3: Implement**
  - `displayName`, `findSettings` and `cachedBusinessName` as above.
  - `password-reset.ts` builds both subjects from `displayName((await findSettings())?.businessName)`, read fresh because services don't use the Next cache.

- [ ] **Step 4: Wire the pages**
  - Root layout: replace the static `metadata` with `generateMetadata()` returning `{ title: await cachedBusinessName(), description: "Stock management and billing" }`.
  - Login and forgot-password pages: `generateMetadata()` with the titles from Global Constraints (forgot-password keeps `robots: { index: false }`). The login `<h1>` shows the name.
  - App layout: passes `businessName={await cachedBusinessName()}` to `Sidebar`, which shows it instead of the hard-coded text.

- [ ] **Step 5: Verify**

Run: `pnpm vitest run tests/lib/business-name.test.ts tests/services/settings.test.ts tests/services/password-reset.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS and clean. Then `grep -rn "Sparepartslk" src`: the only hit is the fallback in `src/lib/business-name.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(settings): show each company's own name; fall back to Sparepartslk"
```

---

### Task 2: Logo in the database; Supabase leaves the code

**Files:**
- Create:
  - `src/server/db/schema/logo.ts`;
  - `drizzle/0013_logo.sql` (generated, plus the RLS line) and its meta;
  - `src/server/services/logo.ts`;
  - `src/app/api/logo/route.ts`.
- Delete: `src/server/supabase.ts`
- Modify:
  - `src/server/db/schema/index.ts`;
  - `src/server/actions/settings.ts`;
  - `src/server/services/settings.ts` (logoUrl check; delete the logo row when saving null);
  - `next.config.ts` (`bodySizeLimit`);
  - `package.json` (remove `@supabase/supabase-js`);
  - `.env.example` (drop the Supabase keys).
- Test: `tests/services/logo.test.ts`, `tests/services/settings.test.ts`, `tests/services/schema.test.ts` (the existing RLS test covers the new table), `e2e/settings-logo.spec.ts`, `e2e/fixtures/logo.png` (a valid PNG under 2 KB)

**Interfaces:**
- Produces:
  - Table `logo`, exported from schema: `id smallint pk default 1` with check `logo_single_row` (`id = 1`), `contentType text not null`, `data bytea not null`, `updatedAt timestamptz not null default now()`. `bytea` is a drizzle `customType<{ data: Buffer }>` named `bytea`, defined in `logo.ts`.
  - `LOGO_MAX_BYTES = 1024 * 1024`.
  - `saveLogo(user: SessionUser, file: { type: string; bytes: Uint8Array }): Promise<{ url: string }>`. Admin only. Throws `DomainError("Validation", …, { field: "logo" })` with today's messages: `"Choose an image"` (empty), `"Use a PNG, JPG or WebP image"` (type, or bytes not matching), `"Keep the logo under 1 MB"`. Upserts row 1.
  - `readLogo(): Promise<{ contentType: string; data: Buffer; updatedAt: Date } | null>`.
  - `logoUrlFor(updatedAt: Date): string` returns `/api/logo?v=${updatedAt.getTime()}`.
  - `GET /api/logo`: 200 with the headers from Global Constraints, or 404 with no row.

- [ ] **Step 1: Write the failing tests** in `tests/services/logo.test.ts` (after `resetDb`, admin via `makeUser("admin")`):
  - A real PNG (the fixture's bytes) is stored. `readLogo()` returns the same bytes and `image/png`, and the url matches `/^\/api\/logo\?v=\d+$/`.
  - A second upload replaces the first: still one row, with the new bytes.
  - Refused with field `"logo"`: an empty file; `image/gif`; `image/png` whose bytes start `<svg`; 1 MB + 1 byte of valid-PNG-header bytes. No row is written in any of these cases.
  - Staff gets `Forbidden`.
  - The route: `GET(new Request("http://x/api/logo?v=1"))` from `@/app/api/logo/route` returns 200, the bytes, the `Content-Type`, `nosniff` and the cache header. With a stale `?v=123` it returns the current bytes (Review Focus 4). With no row, 404.

  In `tests/services/settings.test.ts`:
  - `updateSettings` with `logoUrl: null` deletes the `logo` row;
  - `logoUrl` `"/api/logo?v=17"` and `"https://x.supabase.co/a.png"` are accepted;
  - `"http://x/a.png"`, `"javascript:alert(1)"` and `"/api/logo?v=abc"` are refused (`ZodError`).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/services/logo.test.ts tests/services/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Schema and migration**
  - Define the table. Run `pnpm db:generate --name logo`.
  - Expected: `0013_logo.sql` holds only the `CREATE TABLE "logo"` and its check constraint.
  - Append `--> statement-breakpoint\nALTER TABLE "logo" ENABLE ROW LEVEL SECURITY;` with the Edit tool.
  - Rebuild the test database: drop `sparepartslk_test` as in step 1's Task 1, then let global-setup recreate it.

- [ ] **Step 4: Implement**
  - `logo.ts` as above. Magic bytes:
    - PNG `89 50 4E 47 0D 0A 1A 0A`;
    - JPEG `FF D8 FF`;
    - WebP `52 49 46 46` at bytes 0–3 and `57 45 42 50` at bytes 8–11.
  - The route reads `readLogo()`.
  - `uploadLogoAction` calls `saveLogo(await requireUser(), { type: file.type, bytes })`.
  - `updateSettings` runs its update and, when `data.logoUrl === null`, `delete from logo`, in one transaction.
  - The `logoUrl` schema: `z.union([z.string().regex(/^\/api\/logo\?v=\d+$/), z.url({ protocol: /^https$/ })]).nullish()`.
  - Delete `src/server/supabase.ts`. Run `pnpm remove @supabase/supabase-js`. Remove the three Supabase keys from `.env.example`.
  - Add `experimental: { serverActions: { bodySizeLimit: "2mb" } }` to `next.config.ts`.

- [ ] **Step 5: Verify**

Run: `pnpm vitest run tests/services/logo.test.ts tests/services/settings.test.ts tests/services/schema.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS and clean. `grep -rn "supabase" src` finds nothing.

- [ ] **Step 6: e2e** — `e2e/settings-logo.spec.ts`:
  1. Admin opens Settings and uploads `e2e/fixtures/logo.png` with `setInputFiles` on the logo input.
  2. Clicks "Save settings".
  3. Opens the print page of an invoice made by the full-flow spec (`/print/invoice/<id>`; find the id from `/invoices`).
  4. Expects an `img` whose `src` matches `/api\/logo\?v=\d+/` with `naturalWidth > 0`.

Run: `pnpm test:e2e e2e/settings-logo.spec.ts e2e/full-flow.spec.ts`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(settings): keep the logo in the database; drop Supabase Storage"
```

---

### Task 3: Health check, client IP setting, build switch, safety headers

**Files:**
- Create: `src/app/api/health/route.ts`
- Modify:
  - `src/server/request-ip.ts`;
  - `src/middleware.ts` (matcher: add `api/health` to the excluded list; use the Edit tool);
  - `next.config.ts` (output switch and headers);
  - `.env.example` (`CLIENT_IP_HEADER` with its comment).
- Test: `tests/lib/reset-code.test.ts` ("request IP" block), `tests/services/health.test.ts`, `tests/services/middleware.test.ts`

**Interfaces:**
- Produces:
  - `requestIp(headers: Headers, onVercel = Boolean(process.env.VERCEL), clientIpHeader = process.env.CLIENT_IP_HEADER): string`.
  - `GET /api/health`.

- [ ] **Step 1: Write the failing tests**
  - `requestIp`:
    - with `clientIpHeader` `"cf-connecting-ip"` and headers `{ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }`, it returns `"9.9.9.9"` (both with `onVercel` false and true);
    - the same setting without that header falls back: `"x-forwarded-for": "6.6.6.6, 3.3.3.3"` with `onVercel` false gives `"3.3.3.3"`;
    - an empty-string setting behaves as today;
    - the existing "ignores cf-connecting-ip" test passes `""` explicitly.
  - `health.test.ts`: `GET()` returns status 200, text `"ok"`, `Content-Type` starting `text/plain` and `Cache-Control` `"no-store"`.
  - `middleware.test.ts` matcher test: `/api/health` doesn't match the guard; `/api/logo` and `/api/healthx` do.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/lib/reset-code.test.ts tests/services/health.test.ts tests/services/middleware.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `requestIp` (update its doc comment: set `CLIENT_IP_HEADER` only where nothing but that proxy reaches the app);
  - the health route (`export const dynamic = "force-dynamic"`);
  - the matcher: `api/health(?:$|/)`, so `/api/healthx` stays guarded.
  - `next.config.ts`: the output switch and the five headers on `source: "/:path*"`.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run tests/lib/reset-code.test.ts tests/services/health.test.ts tests/services/middleware.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ops): health check, client IP setting, standalone build switch, safety headers"
```

---

### Task 4: Setup service

**Files:**
- Create: `src/server/services/setup.ts`
- Test: `tests/services/setup.test.ts`

**Interfaces:**
- Consumes: `insertBaseData(tx)`, `createLogin(input, tx)` (step 1), `takeLimit` / `HOUR`, `passwordSchema`, `refreshSettings` (only from the action, Task 5).
- Produces:
  - `SETUP_KEY_MIN = 24`, `SETUP_LOCK_ID = 72026110`.
  - `companyExists(ex?: Executor): Promise<boolean>`.
  - `setupKeyState(key = process.env.SETUP_KEY): "missing" | "ready"`. "missing" means unset, or shorter than 24 characters after trimming.
  - `setupSchema`: zod object `{ setupKey, businessName (trim, 1–80), ownerName (trim, 1–80), email (trim, z.email), password: passwordSchema, confirmPassword }`. On a mismatch, the refine error is on `confirmPassword`: `"The two passwords don't match"`.
  - `setupCompany(input: z.input<typeof setupSchema>, ctx: { ip: string }, deps?: { setupKey?: string }): Promise<{ ok: true; userId: string; email: string } | { ok: false; field?: string; message: string }>`.
  - Order:
    1. parse;
    2. `takeLimit("setup-ip/<ip>", 10, HOUR)`;
    3. key state;
    4. key compare: sha256 of the trimmed values, `timingSafeEqual`;
    5. the transaction, as spec §4.3.
  - Validation errors come back as `{ ok: false, field, message }`, never thrown.

- [ ] **Step 1: Write the failing tests** (`resetDb()`, then `db.delete(profiles)` so no company exists; `KEY = "k".repeat(24)`; a fresh ip per test):
  - `companyExists()` is false on an empty profiles table, and true after `makeUser("staff")`.
  - `setupKeyState(undefined)`, `setupKeyState("")` and `setupKeyState("x".repeat(23))` are `"missing"`; `setupKeyState(KEY)` is `"ready"`.
  - Missing or short key: `{ ok: false, message: <locked copy> }`, and no profile is written.
  - Wrong key: `{ ok: false, field: "setupKey", message: "The setup key is wrong." }`, and no profile.
  - **The key with surrounding whitespace** (`"  " + KEY + "\n"`) is accepted (Review Focus 2).
  - Success, with business name `"Silva Motors"` and owner email `"Owner@Silva.LK"`:
    - `ok: true`;
    - `settings.businessName` is `"Silva Motors"`;
    - 3 price tiers and the walk-in customer exist;
    - exactly one profile, role admin, email `"owner@silva.lk"`;
    - `signIn({ email: "OWNER@silva.lk", password, ip, headers: new Headers() })` is ok (Review Focus 3).
  - Blank business name `"   "`: `ok: false`, field `"businessName"`.
  - Passwords that don't match: field `"confirmPassword"`.
  - Once a company exists, a valid submit gives `{ ok: false, message: "This system is already set up. Sign in instead." }`, and the profile count is unchanged.
  - **Eight valid submits at once** (`Promise.all`, different emails, different ips): exactly one `ok: true`, and exactly one profile.
  - From one ip: 10 wrong-key tries, then the 11th with the right key gives `"Too many tries. Wait a while and try again."`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/services/setup.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/server/services/setup.ts`.** Lock with `` tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_ID})`) `` as the first statement of the transaction, then re-check `companyExists(tx)`.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run tests/services/setup.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(setup): set up a new company once, behind a setup key"
```

---

### Task 5: Setup screen, login redirect, e2e on an empty database

**Files:**
- Create: `src/app/(auth)/setup/page.tsx`, `src/app/(auth)/setup/setup-form.tsx` (client), `src/app/(auth)/setup/actions.ts`, `e2e/setup/setup.spec.ts`
- Modify:
  - `src/app/(auth)/login/page.tsx` (redirect to `/setup` when no company exists);
  - `src/middleware.ts` matcher (exclude `setup(?:$|/)`; use the Edit tool);
  - `playwright.config.ts`, `e2e/global-setup.ts`;
  - `.env.example` (`SETUP_KEY` with its comment).
- Test: `tests/services/middleware.test.ts`, `e2e/setup/setup.spec.ts`

**Interfaces:**
- Consumes:
  - `companyExists`, `setupKeyState`, `setupCompany` (Task 4);
  - `signIn` (step 1), `requestIp` (Task 3), `cachedBusinessName`, `refreshSettings`.
- Produces:
  - `setupAction(prev: SetupState, formData: FormData): Promise<SetupState>`, with `SetupState = { error?: string; field?: string; values?: Record<string, string> }`. Password fields are never echoed back.
  - On success: `refreshSettings()`; then `signIn({ email, password, ip, headers })`; `redirect("/dashboard")` if ok, else `redirect("/login")`.

- [ ] **Step 1: Matcher test, failing.** In `tests/services/middleware.test.ts`, `/setup` doesn't match the guard; `/setupx` and `/settings` do. Run it and expect FAIL. Then edit the matcher with the Edit tool and expect PASS.

- [ ] **Step 2: Page and form.**
  - The page is a server component with `export const dynamic = "force-dynamic"`:
    - `if (await companyExists()) redirect("/login")`;
    - `setupKeyState() === "missing"` shows only the locked copy;
    - otherwise it shows `<SetupForm />`.
  - Layout and wording follow the login page: heading `"Set up <businessName>"`, using "Sparepartslk" before setup.
  - Labels: "Setup key", "Business name", "Your name", "Email", "Password", "Password again"; the button is "Set up".
  - The form uses `useActionState(setupAction, {})` and shows the error next to its field, or at the top when there is no field.
  - The login page starts with `if (!(await companyExists())) redirect("/setup")`.

- [ ] **Step 3: e2e setup project.**
  - `playwright.config.ts`:
    - add a second `webServer` on port 3101, with `NEXT_DIST_DIR=.next-e2e-setup`, `DATABASE_URL=<setup db url>` and `SETUP_KEY=e2e-setup-key-0123456789abcd`;
    - the setup db url is `TEST_DATABASE_URL` with its database name replaced by `sparepartslk_setup_e2e`.
    - Projects: the existing `chrome` (add `testIgnore: "setup/**"`), and a new `setup` (`testMatch: "setup/**"`, `baseURL: http://localhost:3101`).
  - `global-setup.ts` also creates and migrates the setup database, then empties all its tables. No base data and no logins: an empty company.
  - `e2e/setup/setup.spec.ts`, in order:
    1. `/dashboard` lands on `/setup`, whose heading reads "Set up Sparepartslk" (Review Focus 1: no settings row).
    2. A wrong key shows "The setup key is wrong."
    3. The right key plus "Silva Motors", an owner name, `Owner@Silva.LK` and a password reaches `/dashboard`, with the sidebar showing "Silva Motors".
    4. `/setup` then redirects to `/login`.
    5. Signed out, `/login`'s heading shows "Silva Motors".

- [ ] **Step 4: Verify**

Run: `pnpm vitest run tests/services/middleware.test.ts && pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: all unit tests pass; every e2e spec passes in both projects.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(setup): one-time setup screen for a new company"
```

---

### Task 6: Docs, full check, production build

**Files:**
- Modify:
  - `README.md` (local setup without Supabase keys; deploy: `/setup` instead of `db:seed`; the settings list);
  - `.env.example` (final list with comments, spec §5);
  - `docs/superpowers/plans/2026-11-07-better-auth.md` (Task 8: `0013` becomes `0014`);
  - `docs/operations/better-auth-release.md` (step 7: `0014`).
- Create: `docs/operations/settings-only-release.md` (spec §6 as a checklist, with the `0013_logo` tracking-row SQL: the sha256 of `git show HEAD:drizzle/0013_logo.sql` and the journal `when`)

- [ ] **Step 1: Write the docs** above.

- [ ] **Step 2: Full check**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: clean, all pass.

- [ ] **Step 3: Production build on an empty local database.**
  1. Create the database `sparepartslk_setup_check` locally and migrate it.
  2. `pnpm build`, then `DATABASE_URL=<that db> SETUP_KEY=<24+ chars> pnpm start -p 3200`.

  Expected:
  - `/api/health` gives `ok` with no cookie;
  - `/dashboard` → `/login` → `/setup`;
  - setup reaches the dashboard showing the new name;
  - the response headers include the five safety headers;
  - uploading a logo shows it on Settings.

  Then drop the database.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: settings-only release checklist; README without Supabase keys"
```
