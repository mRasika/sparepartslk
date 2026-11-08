# Sparepartslk — Settings-only app and setup screen — Design Spec

- **Date:** 2026-11-07
- **Status:** Draft for review
- **Scope:** Step 2 of the Docker plan. Make one image that any company can run: nothing about a company in the code, a one-time setup screen for a new company's empty database, a health check, and the logo stored without Supabase. Step 3 (Dockerfile, stack, jobs container, backups, stack test) and step 4 (install) get their own specs.

## 1. Context & goals

Step 1 moved login to Better Auth (released 2026-11-07, PR #30). What still ties the app to one shop or to Supabase:

- "Sparepartslk" is hard-coded in the browser titles, the sign-in heading, the sidebar and the two password emails.
- The logo is uploaded to Supabase Storage (`src/server/actions/settings.ts`).
- The first admin is made with a command-line seed (`scripts/seed.ts`), which a Docker deploy must not do.
- There is no health check, no self-contained build output, and the visitor address for sign-in limits can't be read correctly behind the Cloudflare tunnel.

**Decided with the owner (2026-11-07)**
- Every company is in **Sri Lanka**: rupees, Colombo time and the VAT rules stay built in.
- Each company's **own business name** shows in the sidebar, sign-in page, browser tab and emails (fallback "Sparepartslk").
- The setup screen asks for **business name and the owner's login only**. Address, phone, TIN, VAT and logo are filled in Settings afterwards, as today. No demo data.
- The **logo lives in the database**. The current shop's owner uploads the logo again once; it is not copied.

**Success criteria**
- A fresh database plus the right settings gives a working company through the browser alone: open the address → setup screen → owner signed in on the dashboard.
- Nobody without the setup key can claim a new company, and setup can never run twice.
- The code holds no company name, logo or address, and no Supabase package.
- The current shop on Vercel works as before. The only visible change is re-uploading the logo once.

**Not in this step:** Docker files, the jobs container that replaces pg_cron `reconcile-stock`, backups, and moving the current shop off Vercel.

## 2. Company name

- `businessName()` in `src/server/cached.ts` returns the trimmed `settings.business_name` from `cachedSettings`, or `"Sparepartslk"` when empty.
- **Uses:**
  - the root layout's `generateMetadata`: title `<name>`;
  - the login and forgot-password page titles: `Sign in · <name>`, `Forgot password · <name>`;
  - the sign-in page heading;
  - the sidebar (a new `businessName` prop, passed in by `src/app/(app)/layout.tsx`);
  - the two password emails: `Your <name> password code` and `Your <name> password was changed`.
- The sign-in, forgot-password and setup pages read it without a login. A business name is not secret.
- Saving Settings already calls `refreshSettings()`, so a new name shows at once.

## 3. Logo

### 3.1 Data — migration `0013_logo`

| Table | Columns | Notes |
| --- | --- | --- |
| `logo` | `id smallint pk default 1 check (id = 1)`, `content_type text not null`, `data bytea not null`, `updated_at timestamptz not null default now()` | one row at most; RLS on, no policies (like every table) |

The logo is kept out of `settings` so `cachedSettings` never carries up to 1 MB.

**Numbering:** the Better Auth cleanup from step 1's plan (Task 8) becomes `0014`, after this.

### 3.2 Upload, show, remove

- **Upload:** `uploadLogoAction` (admin only) keeps today's checks: PNG, JPEG or WebP, at most 1 MB, plus a check of the file's first bytes against its claimed type. It then upserts the `logo` row and returns `{ url: "/api/logo?v=<updated_at ms>" }`. The Settings form saves that URL into `settings.logo_url`, as today.
- **Show:** `GET /api/logo` needs a signed-in user (the middleware covers it, like every page). It answers with the stored bytes, the stored `Content-Type`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, max-age=31536000, immutable`; the `?v=` changes on every upload. With no row it answers 404. The print page and Settings page keep using `settings.logo_url` unchanged.
- **Remove:** saving Settings with no logo deletes the `logo` row in the same transaction.
- **Settings check:** `logoUrl` accepts `null`, `/api/logo?v=<digits>`, or an `https://` URL (the current shop's existing Supabase Storage link, until it is replaced).
- **Removed from the code:** `@supabase/supabase-js`, `src/server/supabase.ts`, and every read of `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Local development still runs Postgres through the Supabase CLI. That is a developer tool, not an app dependency.

## 4. Setup screen

### 4.1 When it shows

- "A company exists" means **at least one row in `profiles`**: `companyExists()` in `src/server/services/setup.ts`, a `select 1 … limit 1`.
- **`/login`:** when no company exists, it redirects to `/setup`. So the first visit to a new company's address lands on setup: the middleware sends to `/login`, and `/login` sends on to `/setup`.
- **`/setup`:**
  - The middleware skips it, the same as `/login`.
  - When a company exists, it redirects to `/login`, for good.
  - When no company exists but `SETUP_KEY` is missing or shorter than 24 characters, it shows only: "Setup is locked. Put a SETUP_KEY of at least 24 characters in the stack settings, then reload this page."
  - Otherwise, it shows the form.

### 4.2 The form

Fields:
- Setup key (password field);
- Business name (1–80 characters);
- Owner's name (1–80 characters);
- Owner's email;
- Password and Password again (`passwordSchema`: 8–72 bytes; the two must match).

The Settings form's wording and layout style is reused.

### 4.3 What submitting does — `setupCompany(input, deps)` in `src/server/services/setup.ts`

1. **Validate** the form with zod. Field errors show next to their fields.
2. **Rate limit:** `takeLimit("setup-ip/<ip>", 10, HOUR)`. Over the limit: "Too many tries. Wait a while and try again."
3. **Key:** compare the sha256 of the typed key with the sha256 of `SETUP_KEY` using `timingSafeEqual`.
   - A missing or short `SETUP_KEY` gives "Setup is locked…" (as in §4.1).
   - A wrong key gives "The setup key is wrong." in the key field.
4. **In one transaction:**
   - `pg_advisory_xact_lock(72026110)` (a fixed number used only for setup), so concurrent submits wait for each other;
   - if `companyExists()`, stop with "This system is already set up. Sign in instead.";
   - `insertBaseData(tx)`: price tiers, walk-in customer, settings row;
   - set `settings.business_name`;
   - `createLogin({ email, name, password, role: "admin" }, tx)`.
5. **After commit:**
   - `refreshSettings()`;
   - sign the owner in with the existing `signIn` service (same limits and cookie as the sign-in page);
   - redirect to `/dashboard`.
   - If that sign-in fails, redirect to `/login`. The company is set up either way.

`deps` carries `setupKey` for tests (default `process.env.SETUP_KEY`).

### 4.4 After setup

- `/setup` redirects to `/login` from then on.
- The step 3 guide tells the operator to empty `SETUP_KEY` in the stack settings once setup is done.
- `pnpm db:seed` stays for local development and tests. The README's deploy section says a new deployment is set up at `/setup`.

## 5. Health, build and settings

- **`GET /api/health`** answers `ok` (`text/plain`, `Cache-Control: no-store`), with no login and no database. The middleware matcher excludes `api/health`.
- **Build output:** `next.config.ts` sets `output: "standalone"` only when `NEXT_OUTPUT=standalone`. The Docker build sets it in step 3; Vercel and local builds don't change.
- **Safety headers on every response:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
- **Visitor address for sign-in limits:** `requestIp` reads `CLIENT_IP_HEADER` when it is set (Docker sets it to `cf-connecting-ip`). If that header is missing on a request, it falls back to today's rules. When the setting is empty, nothing changes: Vercel takes the first `x-forwarded-for` entry, elsewhere the last. **Only set it where the app can't be reached except through that proxy**, which is true in the Docker stack (no open ports; only the stack's own tunnel reaches `app`).
- **`.env.example`** lists every setting the app reads, each with a plain-words comment: `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SETUP_KEY`, `CLIENT_IP_HEADER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_OUTBOX_DIR`, `FEATURE_SALES_TARGET`. The Supabase keys go.

## 6. Release for the current shop

1. Apply `0013_logo` to the cloud database through the MCP, with its drizzle tracking row (as in step 1).
2. Merge into `development` and check Preview:
   - the sidebar and tab show the shop's business name;
   - `/setup` redirects to `/login`;
   - `/api/health` gives `ok`;
   - the existing logo still shows (its Supabase link);
   - **don't upload a new logo on Preview**: Preview and Production share the database, so it would change Production's logo too.
3. Release to Production. The owner then uploads the logo on Settings once, and checks it on an invoice's print page.
4. After that, remove `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from Vercel.

**Rollback:** `vercel rollback` to the deployment before the release. The old code reads `settings.logo_url`, which holds either the old Supabase link or an `/api/logo` path. An `/api/logo` path would show no logo on the old code, so roll back before the owner re-uploads, or accept a missing logo until roll-forward.

## 7. Testing

**Unit tests** (Vitest, real Postgres):
- `businessName()`: the saved name, or "Sparepartslk" when empty or blank.
- `setupCompany`:
  - refused for a missing key, a key shorter than 24 characters, and a wrong key (no rows written);
  - on success, writes the tiers, walk-in customer, settings with the business name, and one admin login that can sign in;
  - refused once a profile exists;
  - **eight submits at the same moment** create exactly one company and one login;
  - the 11th try from one device in an hour is refused.
- `companyExists()`: false on an empty database, true after one profile.
- **Logo:**
  - upload stores the bytes and type and returns `/api/logo?v=…`;
  - refused: over 1 MB, a type not on the list, and a PNG name with non-PNG bytes;
  - `GET /api/logo` returns the bytes with the stored type and `nosniff`, or 404 when there is none;
  - saving Settings with no logo deletes the row;
  - the settings check accepts null, the `/api/logo` form and https, and refuses `http:` and `javascript:`.
- `requestIp` with `CLIENT_IP_HEADER` set: reads that header; falls back when it is missing; ignores it when the setting is empty.
- `/api/health` returns `ok`.

**End-to-end** (Playwright):
- A separate `setup` project with its own empty database (`TEST_SETUP_DATABASE_URL`) and its own dev server started with a test `SETUP_KEY`:
  - `/dashboard` → `/login` → `/setup`;
  - a wrong key shows the error;
  - the right key leads to the dashboard showing the new business name in the sidebar;
  - `/setup` then redirects to `/login`.
- In the main project: an admin uploads a small PNG logo on Settings, saves, and sees it on an invoice's print page.
- All existing specs still pass.

**Production build:** `pnpm build && pnpm start` against an empty local database with a `SETUP_KEY`. Do the setup, see the dashboard, check `/api/health`, and check the response headers.

## 8. Risks

| Risk | Handling |
| --- | --- |
| Someone finds a new company's address before the owner | setup needs the key (24+ characters, timing-safe compare, 10 tries per device per hour); the guide says to empty it after setup |
| Two setups at once | advisory lock plus re-checking `companyExists()` inside the transaction |
| A spoofed `cf-connecting-ip` | only read when `CLIENT_IP_HEADER` is set, which only the Docker stack does, where nothing but its own tunnel reaches the app |
| A logo upload on Preview changes Production | shared database; the release notes say not to upload on Preview |
| A 1 MB logo is slow to load | browsers cache it for a year; `?v=` changes on upload |
| Server actions refuse bodies over 1 MB, so a logo near 1 MB could fail on upload | set `experimental.serverActions.bodySizeLimit` to `"2mb"` |
