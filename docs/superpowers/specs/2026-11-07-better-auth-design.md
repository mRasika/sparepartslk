# Sparepartslk — Login on Better Auth — Design Spec

- **Date:** 2026-11-07
- **Status:** Draft for review
- **Scope:** Step 1 of the Docker plan: replace Supabase Auth with Better Auth, storing logins and sessions in the app's own Postgres. Steps 2–4 (settings-only app and setup screen, Docker stack and backups, customer install) get their own specs.

## 1. Context & goals

A second shop is waiting for its own copy of Sparepartslk. It will run as a Docker stack on the Oracle server, the same way as the laundry app: one Postgres per company, with no outside services. Today, login runs on Supabase Auth, a separate service that is too heavy to host for each company. Better Auth keeps logins and sessions as ordinary tables in the app's database.

The current shop stays on Vercel and the Supabase Postgres. After this change it runs the same code, with Better Auth in place of Supabase Auth.

**Success criteria**
- The current shop runs on Better Auth on Vercel, with no data lost. All past records stay linked to the same people.
- **The 4 existing logins keep their passwords.** After the release, people sign in once more with the same password.
- A login stays signed in on a device until it hasn't been used for **30 days**.
- Signing out, turning a login off, Set password and a reset by email code take effect on that user's **next request**.
- The app no longer needs Supabase login keys. `@supabase/supabase-js` and the Supabase keys remain only for the logo upload, which moves off Supabase in step 2.
- Nothing staff see changes, except that they sign in again once at release.

**Not in this step:** the logo upload (Supabase Storage), the nightly stock check (pg_cron), the shop name in code, the setup screen, and Docker files.

## 2. Where Supabase is used today

| Place | Use | This step |
| --- | --- | --- |
| `src/middleware.ts` | refreshes the session cookie; redirects signed-out visitors | Better Auth |
| `src/server/auth.ts` | `getSessionUser` from the Supabase JWT, plus the `amr` sign-in time against `profiles.signed_out_at` | Better Auth session plus the profile |
| `src/app/(auth)/login/actions.ts` | `signInWithPassword`, `signOut` | Better Auth |
| `src/server/services/users.ts` | `auth.admin.createUser`, `updateUserById` | direct writes in a transaction |
| `src/server/services/password-reset.ts` | `updateUserById`; code hash keyed with `SUPABASE_SERVICE_ROLE_KEY` | direct writes; key is `BETTER_AUTH_SECRET` |
| `src/server/actions/settings.ts` | logo upload to Supabase Storage | unchanged (step 2) |
| `scripts/seed.ts`, `e2e/global-setup.ts` | create logins in Supabase Auth | `createLogin` |
| `supabase/cron.sql` | pg_cron `reconcile-stock` | unchanged (step 3) |

Every user reference in the data (`created_by`, `updated_by`, `cancelled_by`, `converted_by`) points at `profiles.user_id`. Nothing points at Supabase's `auth.users`.

## 3. Data

### 3.1 New tables — migration `0012_better_auth` (added before the code)

Better Auth's standard tables, defined in `src/server/db/schema/auth.ts` and generated with `drizzle-kit`.

| Table | Columns | Notes |
| --- | --- | --- |
| `user` | `id uuid pk`, `email text unique not null`, `name text not null`, `email_verified boolean not null default false`, `image text`, `created_at`, `updated_at` | `id` equals `profiles.user_id`. Better Auth generates uuids (`advanced.database.generateId: "uuid"`), but our code always passes the id. |
| `account` | `id uuid pk`, `account_id text not null`, `provider_id text not null`, `user_id uuid not null → user(id) on delete cascade`, `password text`, token columns (unused), `created_at`, `updated_at` | one `credential` row per user; `account_id` = the user id as text |
| `session` | `id uuid pk`, `token text unique not null`, `user_id uuid not null → user(id) on delete cascade`, `expires_at`, `ip_address`, `user_agent`, `created_at`, `updated_at` | index on `user_id` |
| `verification` | `id uuid pk`, `identifier`, `value`, `expires_at`, `created_at`, `updated_at` | required by Better Auth, unused; reset codes stay in `password_reset_codes` |

0012 only adds tables. It adds no foreign key on `profiles` and drops nothing, so the old code on production keeps working while 0012 is in place.

### 3.2 Cleanup — migration `0013_better_auth_cleanup` (after the release is confirmed)

- `profiles.user_id` gets a foreign key to `user(id)`.
- `profiles.signed_out_at` is dropped. Deleting session rows replaces it.

0013 goes to the cloud database only after production has run on Better Auth for a day or two (§6). Local, test and Docker databases run both migrations in order.

### 3.3 Passwords

- Hashing is **bcrypt** (`bcryptjs`, cost 10), the same as Supabase. It is set through Better Auth's `emailAndPassword.password.{hash, verify}`.
- Copied Supabase hashes (`$2a$10$…`) verify as they are. `passwordSchema` stays as it is (8 to 72 bytes; bcrypt reads at most 72).

## 4. Components

### 4.1 `src/server/better-auth.ts` (new)

- `betterAuth({ database: drizzleAdapter(db, { provider: "pg", schema }), … })`.
- `emailAndPassword: { enabled: true, disableSignUp: true, password: { hash, verify } }`.
- `session: { expiresIn: 30 days, updateAge: 1 day, cookieCache: { enabled: true, maxAge: 5 min } }`.
- `secret: BETTER_AUTH_SECRET`. At start-up, a missing secret or one shorter than 32 characters throws a clear error.
- `baseURL` comes from `BETTER_AUTH_URL` when set. Otherwise Better Auth reads it from the request.
- `plugins: [nextCookies()]`, so server actions can set the cookie.
- **No `/api/auth/[...all]` route.** Every call goes through `auth.api.*` from server code, so there are no public auth endpoints.

### 4.2 `src/server/auth.ts` (inside changed, outside the same)

- `SessionUser`, `getSessionUser`, `requireUser` and `requireRole` keep their names and types. No caller changes.
- `getSessionUser` (memoised per request) calls `auth.api.getSession({ headers, query: { disableCookieCache: true } })`, then `loadActiveUser(userId)`. It returns null when there is no session, the session has expired or been deleted, or the profile is missing or turned off.
- `loadActiveUser` loses its `signedInAt` parameter. `sessionSignedInAt` is removed.

### 4.3 `src/server/auth-admin.ts` (new)

Direct writes to the auth tables. Every function takes an optional transaction `tx`, so callers can join it to their own transaction.

- `createLogin({ id?, email, name, password, role, canGetEmails }, tx?)` inserts `user`, the `account` (bcrypt hash) and the `profile` in **one transaction**. It returns `{ id }`. A duplicate email rolls everything back.
- `setPassword(userId, password, tx?)` updates the `account.password` hash and deletes every `session` of that user.
- `endSessions(userId, tx?)` deletes every `session` of that user.

### 4.4 Callers

- **Login action** (`src/app/(auth)/login/actions.ts`):
  1. Validate the form.
  2. `takeLimit("login-email/<email>", 10, HOUR)` and `takeLimit("login-ip/<ip>", 30, HOUR)`. Over the limit, show "Too many tries. Wait a while and try again." **Only failed tries count:** a successful sign-in hands its two counts back with a new `giveBack(key)` in `rate-limit.ts` (an atomic decrement, never below 0). Counting first and handing back afterwards stays safe when many tries arrive at the same moment. A shop where everyone shares one internet address, and the e2e tests, never hit the limit through normal sign-ins.
  3. Call `auth.api.signInEmail({ body, headers })`.
  4. A wrong email or password shows "Email or password is incorrect". Any other error is logged with `console.error` and shows the same message.
  5. If the profile is turned off, call `endSessions` and show "This account is turned off. Ask the owner to turn it back on."
  6. Redirect to `/dashboard`.
- **Logout action:** `auth.api.signOut({ headers })`, then redirect to `/login`.
- **`users.ts`:**
  - `createUser` calls `createLogin`. The `AuthAdmin` and `PasswordAdmin` fakes are removed.
  - `setUserActive(…, false)` also calls `endSessions`.
  - `setUserPassword` runs `setPassword` and the reset-code delete in one transaction.
- **`password-reset.ts`:**
  - Inside the existing transaction, `setPassword(user.id, newPassword, tx)` replaces the `signed_out_at` update and the Supabase call.
  - `resetSecret` reads `BETTER_AUTH_SECRET`. The `secret` dependency stays for tests.
- **Seed and e2e setup:** create or update the local logins with `createLogin` and `setPassword`.

### 4.5 Middleware

- It runs on the Node runtime (`export const config = { runtime: "nodejs", matcher }`), supported in Next 15.5.
- It calls `auth.api.getSession({ headers, returnHeaders: true })`. With no session, it redirects to `/login`. Otherwise it copies any `Set-Cookie` headers onto the response, which renews the session and the cookie at most once a day.
- With the cookie cache, most requests need no database query here.
- The matcher stays the same (`login`, `forgot-password` and static files are excluded).

### 4.6 Removed

- The auth parts of `src/server/supabase.ts`: `createSupabaseServerClient` goes; `createSupabaseAdminClient` stays for the logo upload.
- `@supabase/ssr`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the code. It stays in Vercel until step 2, but nothing reads it.

### 4.7 Environment

| Name | Where | Notes |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | `.env.local`, Vercel Preview and Production, `.env.example` | 32+ random characters (`openssl rand -hex 32`); Preview and Production use the same value, since they share the database |
| `BETTER_AUTH_URL` | optional | set in Docker (step 3); Vercel reads the host from the request |

## 5. Request flows

- **Sign in:** form → rate limits → Better Auth checks the bcrypt hash → `session` row + signed http-only, secure, SameSite=Lax cookie → profile active? → dashboard.
- **Any page or action:**
  1. The middleware checks the session (cookie cache, at most 5 minutes old) and renews it daily.
  2. `getSessionUser` reads the session row and the profile: one indexed query each.
  3. Revoking a session or turning off a profile shows on the **next request**.
- **Sign out:** deletes this device's session.
- **Turn off a login:** deletes all of its sessions; the profile check also blocks it.
- **Set password or reset by code:** new hash plus all sessions deleted, in one transaction (with the code spent, for a reset).
- **Database down:** logged, and a plain message. No half-done login can result, because each change is one transaction.

## 6. Release for the current shop

1. Apply `0012_better_auth` to the cloud database through the MCP, and insert its drizzle tracking row (hash of the file as stored in git, LF endings).
2. Run `scripts/ops/copy-supabase-logins.sql` through the MCP:
   - For each profile joined to `auth.users`: upsert `user` (id, email, name from `full_name`, `email_verified = true`), then upsert the `credential` `account` with `password = auth.users.encrypted_password`.
   - It only reads `auth.users`, and it can safely be run again.
   - **Check:** the number of profiles equals the number of users and of accounts, and every `account.password` starts with `$2`.
3. Add `BETTER_AUTH_SECRET` to Vercel Preview and Production.
4. Merge into `development`. **Preview runs Better Auth while production still runs Supabase Auth, on the same database.** Sign in on Preview with real logins, check that the session renews, and check that turning off a test login cuts it off.
5. Just before the `development → main` release, **run the copy script again**, to carry over any password changed on production since step 2.
6. Release to production. Every device is signed out once (old Supabase cookies are ignored); people sign in with the same password. Tell staff beforehand.
7. After a day or two of normal use, apply `0013_better_auth_cleanup` the same way as step 1.

**Rollback:** run `vercel rollback` to the previous production deployment. Supabase Auth was never changed, so the old code works at once. Only a password changed under Better Auth would go back to its old value. Do not apply 0013 until rollback is no longer wanted, because the old code reads `signed_out_at`.

## 7. Testing

**Unit tests** (Vitest, real Postgres):
- `createLogin`: user, account and profile are all written. A duplicate email leaves no rows.
- `setPassword`: the new password verifies and the old one fails. That user's sessions are deleted; another user's sessions remain.
- Password verify accepts a real Supabase-format hash (`$2a$10$…` fixture).
- `getSessionUser`: works for a valid session. Returns null for an expired session, a deleted session, a turned-off profile, a tampered cookie, and no cookie.
- Login action:
  - A wrong password gives the plain message and no session.
  - A turned-off account is left with no session.
  - The 11th failed try for one email within an hour is refused, even with the right password.
  - Successful sign-ins don't use up the limit.
- `users` and `password-reset` tests run against the real `auth-admin` (the Supabase fakes are removed). `setUserActive(false)` ends sessions.
- `tests/helpers/factories.ts` creates a `user` row for each profile, matching 0013's foreign key.

**Copy script, once, on local Supabase:**
1. Create a login in local Supabase Auth.
2. Run the script.
3. Sign in through Better Auth with that password.
4. Run it again and check that nothing changes.

**End-to-end tests** (Playwright): all existing suites pass, plus:
- sign in and sign out
- a turned-off account can't sign in
- Set password signs out a second browser on its next click
- a signed-out visitor is redirected to `/login`

**Production build:** `pnpm build && pnpm start`, sign in, and click through the main pages. The Node-runtime middleware only shows its real behaviour in a production build.

**Preview:** step 4 of §6, before any production release.

## 8. Risks

| Risk | Handling |
| --- | --- |
| A password changed on production between the copy and the release | run the copy again just before the release (§6.5) |
| Node-runtime middleware behaves differently on Vercel | proven on Preview before production |
| One more query per request | indexed token lookup in the same region, on the session pooler (see the pooler notes); same order as the existing profile query |
| No rate limit at sign-in after leaving Supabase | `takeLimit` per email and per device (§4.4) |
| A login created between steps 4 and 6 exists in only one system: one made on production (old code) has no `user` row; one made on Preview (new code) has no Supabase login | the copy rerun (§6.5) picks up production-made logins; don't create logins on Preview before the release |
| Preview and production share the auth tables | intended: it lets Preview prove the real logins; sessions are per device, so they don't clash |
