# Login on Better Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth with Better Auth, storing logins and sessions in the app's own Postgres. Callers of `getSessionUser` / `requireUser` / `requireRole` don't change.

**Architecture:** Better Auth (Drizzle adapter on the existing `db`, email + password only, sign-up off, bcrypt) owns the `user` / `account` / `session` / `verification` tables. `user.id` equals `profiles.user_id`. Admin writes (create login, set password, end sessions) go straight to those tables inside our own transactions (`src/server/auth-admin.ts`). Sign-in and sign-out are server actions calling `auth.api.*`; there is no `/api/auth` route. The middleware runs on the Node runtime, redirects when there is no session, and passes on Better Auth's daily renewal cookies.

**Tech Stack:** Next 15.5.28 (App Router, server actions), Drizzle 0.45 + postgres-js, better-auth 1.7.18, bcryptjs 3.0.3, Vitest on real Postgres, Playwright on `next dev`.

**Spec:** `docs/superpowers/specs/2026-11-07-better-auth-design.md`

## Global Constraints

- Exact versions: `better-auth@1.7.18`, `bcryptjs@3.0.3`. Remove `@supabase/ssr`. Keep `@supabase/supabase-js` (logo upload in `src/server/actions/settings.ts`, untouched).
- bcrypt cost **10**. `passwordSchema` (`src/lib/password.ts`) stays 8–72 bytes.
- Sessions: `expiresIn` **30 days**, `updateAge` **1 day**, `cookieCache` **5 minutes**. `getSessionUser` always passes `disableCookieCache: true`.
- `emailAndPassword.disableSignUp: true`. **No** `src/app/api/auth/**` route.
- `BETTER_AUTH_SECRET` is required and must be at least 32 characters; otherwise throw `"BETTER_AUTH_SECRET must be set to at least 32 characters"`. `BETTER_AUTH_URL` is optional.
- Sign-in limits: `login-email/<normalised email>` **10 per HOUR**, `login-ip/<ip>` **30 per HOUR**. Only failed tries count (a success hands both back).
- User-facing copy, exactly:
  - `"Email or password is incorrect"`
  - `"This account is turned off. Ask the owner to turn it back on."`
  - `"Too many tries. Wait a while and try again."`
- Emails are normalised with `normaliseEmail` from `src/lib/reset-code.ts` (trim + lowercase) everywhere a login is looked up or created.
- Migration `0012_better_auth` only **adds** tables and indexes. No FK on `profiles` and nothing dropped (the old production code must keep working against it). `0013` is Task 8, in a later PR.
- Ids are uuids. Better Auth uses `advanced.database.generateId: "uuid"`.

## Review Focus

1. **An email typed with capitals or spaces at sign-in** must sign in, and must share one rate-limit counter with its lowercase form. Test in Task 4.
2. **A browser that still has old Supabase `sb-*` cookies after the release** must land on `/login`, with no error and no redirect loop. e2e test in Task 6.
3. **Signing in on a second device** must leave the first device signed in, and signing out on one must leave the other signed in. Test in Task 3.
4. **A turned-off user with a live session** who submits a server action gets `Forbidden("Please sign in again")`, not data. Test in Task 5 (`setUserActive` ends sessions) and Task 3 (inactive profile gives null).
5. **A stale or expired session cookie** gives a redirect to `/login`, never a 500. Test in Task 3 (expired gives null) and Task 6 (e2e, cookie for a deleted session).

---

### Task 1: Auth tables, password hashing, test factories

**Files:**
- Modify: `package.json` / `pnpm-lock.yaml` (add deps)
- Create: `src/lib/password-hash.ts`, `src/server/db/schema/auth.ts`, `drizzle/0012_better_auth.sql` (generated) + meta
- Modify: `src/server/db/schema/index.ts`, `tests/helpers/factories.ts`, `tests/setup/env.ts`, `.env.example`
- Test: `tests/lib/password-hash.test.ts`, `tests/services/schema.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(password: string): Promise<string>`
  - `verifyPassword(args: { hash: string; password: string }): Promise<boolean>` (the shape Better Auth's `password.verify` takes)
  - Drizzle tables `user`, `session`, `account`, `verification`, exported from `@/server/db/schema` as `user`, `session`, `account`, `verification`
  - `makeUser` now also inserts a `user` row with the same id

- [ ] **Step 1: Add dependencies**

Run: `pnpm add better-auth@1.7.18 bcryptjs@3.0.3`
Expected: both appear in `dependencies`.

- [ ] **Step 2: Write the failing hash tests** in `tests/lib/password-hash.test.ts`

```ts
// Real hash from local Supabase Auth (GoTrue) for the e2e admin password.
const SUPABASE_HASH = "$2a$10$NSXIN4Nd.ta3dk4Z8G4t/Ocv/hNxTDIaAmlKa0UYk7QFn49Nd1/Jm";

it("verifies a password hashed by Supabase", async () => {
  await expect(verifyPassword({ hash: SUPABASE_HASH, password: "e2e-admin-pass-1" })).resolves.toBe(true);
  await expect(verifyPassword({ hash: SUPABASE_HASH, password: "e2e-admin-pass-2" })).resolves.toBe(false);
});
it("hashes with bcrypt cost 10 and verifies its own hashes", async () => {
  const hash = await hashPassword("counter-pass-1");
  expect(hash).toMatch(/^\$2[ab]\$10\$/);
  await expect(verifyPassword({ hash, password: "counter-pass-1" })).resolves.toBe(true);
});
it("says false (never throws) for a hash that isn't bcrypt", async () => {
  await expect(verifyPassword({ hash: "scrypt:abc", password: "x" })).resolves.toBe(false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run tests/lib/password-hash.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/lib/password-hash.ts`** with `bcryptjs` (`hash(pw, 10)`, `compare`). `verifyPassword` returns false for anything not starting with `$2`.

- [ ] **Step 5: Define `src/server/db/schema/auth.ts`.** Columns as in spec §3.1, snake_case column names, `timestamp(..., { withTimezone: true })`, `defaultNow()` on `created_at` / `updated_at`. Additionally:
  - `session`: index `session_user_id_idx` on `user_id`.
  - `account`: unique index `account_user_provider_uq` on `(user_id, provider_id)`. The copy script (Task 7) upserts on it.

  Export the file from `schema/index.ts`. Don't touch `profiles` yet.

- [ ] **Step 6: Generate the migration**

Run: `pnpm db:generate --name better_auth`
Expected: `drizzle/0012_better_auth.sql` holds only `CREATE TABLE` for the 4 tables, their indexes, and the `account` / `session` → `user` FKs (`ON DELETE cascade`). Nothing touches `profiles` or any other existing table. If it does, fix the schema and regenerate.

- [ ] **Step 7: Update `makeUser`** in `tests/helpers/factories.ts`. Insert into `user` (`id`, `email`, `name: fullName`, `emailVerified: true`) before the profile. Fix the doc comment ("no Supabase auth user" becomes "with a matching Better Auth `user` row, no password"). Do the same for any other factory that inserts `profiles` directly (check `FACTORY_ADMIN_EMAIL`).

- [ ] **Step 8: Test env.** In `tests/setup/env.ts`, after the dotenv calls, set `process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-00"`. In `.env.example`, add `BETTER_AUTH_SECRET=` with the comment `# 32+ random characters: openssl rand -hex 32. Same value on Vercel Preview and Production.` and `BETTER_AUTH_URL=` with the comment `# Optional; set in Docker (the site's https address, no trailing slash).`

- [ ] **Step 9: Add a schema test** to `tests/services/schema.test.ts`: after `resetDb()`, a `user` row plus an `account` row for it can be inserted, and a second `credential` account for the same user fails with code `23505` (use `pgErrorCode`).

- [ ] **Step 10: Run everything**

Run: `pnpm test`
Expected: all pass (the existing suite is unchanged in behaviour; `resetDb` truncates the new tables automatically).

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat(auth): Better Auth tables and bcrypt password hashing"
```

---

### Task 2: Admin writes to the auth tables

**Files:**
- Create: `src/server/auth-admin.ts`
- Test: `tests/services/auth-admin.test.ts`

**Interfaces:**
- Consumes: `hashPassword` (Task 1), tables `user` / `account` / `session` / `profiles`, `Executor` from `@/server/db/client`, `DomainError` from `@/server/errors`.
- Produces:
  - `createLogin(input: { id?: string; email: string; name: string; password: string; role: Role; canGetEmails?: boolean }, ex?: Executor): Promise<{ id: string }>`. Writes `user` (emailVerified true) + `account` (`providerId: "credential"`, `accountId: id`, bcrypt hash) + `profiles`, all inside `ex.transaction(...)` (a savepoint when `ex` is already a transaction). Email goes through `normaliseEmail`. A unique violation on email throws `DomainError("Duplicate", "<email> already has an account", { field: "email" })`.
  - `setPassword(userId: string, password: string, ex?: Executor): Promise<void>`. Updates the `credential` account's hash and deletes all `session` rows of that user. Throws `NotFound("User not found")` when no credential account was updated.
  - `endSessions(userId: string, ex?: Executor): Promise<void>`.

- [ ] **Step 1: Write the failing tests**
  - `createLogin` writes one row each in `user`, `account`, `profiles` with the same id. `verifyPassword` on the stored hash is true for the given password.
  - `createLogin` with `"  Mixed@Case.LK "` stores `mixed@case.lk`.
  - A second `createLogin` with the same email rejects with `DomainError` code `"Duplicate"`, and leaves exactly one `user`, one `account` and one `profiles` row.
  - `createLogin` with an explicit `id` uses it.
  - `setPassword`: the new password verifies, the old one doesn't. That user's 2 `session` rows are gone; another user's session row remains. (Insert session rows directly: `token`, `userId`, `expiresAt`.)
  - `setPassword` on an unknown id rejects with `NotFound`.
  - `endSessions` deletes only that user's sessions.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/services/auth-admin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/server/auth-admin.ts`** to the signatures above.

- [ ] **Step 4: Run them to verify they pass**, then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(auth): create logins, set passwords and end sessions in one transaction"
```

---

### Task 3: Better Auth instance and session lookup

**Files:**
- Create: `src/server/better-auth.ts`
- Modify: `src/server/auth.ts`, `tests/lib/reset-code.test.ts` (drop the `sessionSignedInAt` test)
- Test: `tests/services/auth.test.ts`

**Interfaces:**
- Consumes: `createLogin`, `endSessions` (Task 2), `hashPassword` / `verifyPassword` (Task 1).
- Produces:
  - `auth` (the `betterAuth(...)` instance), exported from `src/server/better-auth.ts`, configured per Global Constraints. Plugins: `[nextCookies()]`.
  - `loadActiveUser(userId: string): Promise<SessionUser | null>`. The `signedInAt` parameter is gone, and so is the `signedOutAt` read.
  - `sessionUserFrom(headers: Headers): Promise<SessionUser | null>`. Calls `auth.api.getSession({ headers, query: { disableCookieCache: true } })`, then `loadActiveUser`.
  - `getSessionUser = cache(async () => sessionUserFrom(await headers()))`. `requireUser` and `requireRole` are unchanged.
  - Removed: `sessionSignedInAt` and the Supabase import.

- [ ] **Step 1: Write the failing tests** in `tests/services/auth.test.ts`. Keep the existing `loadActiveUser` and `requireRole` tests. Add a helper:

```ts
/** Signs in through Better Auth and returns request headers carrying the session cookie. */
async function signedInHeaders(email: string, password: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({ body: { email, password }, headers: new Headers(), returnHeaders: true });
  const cookie = headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return new Headers({ cookie });
}
```

Tests (logins made with `createLogin`):
  - A valid session gives `{ id, email, fullName, role }`.
  - No cookie gives null. A cookie with one character of the token changed gives null.
  - The session row's `expires_at` set to the past gives null.
  - After `endSessions(id)` it gives null.
  - With the profile turned off, it gives null.
  - **Two devices** (Review Focus 3): two `signedInHeaders` for one login both resolve. After `auth.api.signOut({ headers: first })`, `first` gives null and `second` still resolves.
  - `auth.api.signUpEmail(...)` is refused (sign-up off).

If `nextCookies()` throws outside a Next request scope under Vitest, make the plugin list `process.env.VITEST ? [] : [nextCookies()]` and say why in a comment.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/services/auth.test.ts`
Expected: FAIL (`@/server/better-auth` not found).

- [ ] **Step 3: Implement `src/server/better-auth.ts`.**
  - `drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } })`.
  - `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, maxPasswordLength: 72, password: { hash: hashPassword, verify: verifyPassword } }`.
  - `session` values per Global Constraints.
  - `advanced.database.generateId: "uuid"`.
  - Secret check per Global Constraints.
  - `baseURL: process.env.BETTER_AUTH_URL` (undefined is fine).

- [ ] **Step 4: Rewrite the inside of `src/server/auth.ts`** to the Interfaces above. Update the doc comments: revocation is now immediate, because every request reads the session row.

- [ ] **Step 5: Remove the `sessionSignedInAt` test** from `tests/lib/reset-code.test.ts`.

- [ ] **Step 6: Run** `pnpm vitest run tests/services/auth.test.ts tests/lib` and `pnpm typecheck`.
Expected: auth tests pass. The only typecheck errors left are in `login/actions.ts`, `users.ts` and `password-reset.ts` (fixed in Tasks 4–5). Commit with those errors; if errors show up anywhere else, fix them first.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(auth): Better Auth sessions behind getSessionUser"
```

---

### Task 4: Sign-in with rate limits; login and logout actions

**Files:**
- Modify: `src/server/rate-limit.ts`, `src/app/(auth)/login/actions.ts`
- Create: `src/server/services/sign-in.ts`
- Test: `tests/services/sign-in.test.ts`

**Interfaces:**
- Consumes: `auth` (Task 3), `loadActiveUser` (Task 3), `endSessions` (Task 2), `takeLimit` / `HOUR`, `normaliseEmail`, `requestIp`.
- Produces:
  - `giveBack(key: string): Promise<void>` in `rate-limit.ts`: one statement, `count = greatest(count - 1, 0)`.
  - `LOGIN_TRIES_PER_EMAIL = 10`, `LOGIN_TRIES_PER_DEVICE = 30`.
  - `signIn(input: { email: string; password: string; ip: string; headers: Headers }): Promise<{ ok: true; headers: Headers } | { ok: false; error: string }>`. The returned `headers` are Better Auth's response headers (Set-Cookie), for tests.

  Order:
  1. Take both limits. If either is over, return the "Too many tries" copy.
  2. `auth.api.signInEmail({ body, headers, returnHeaders: true })`. A Better Auth `APIError` with status 401 gives the "incorrect" copy. Any other error: `console.error("Sign-in failed", e)`, then the "incorrect" copy.
  3. `loadActiveUser`. If null: `endSessions`, then the "turned off" copy. This counts as a failure, so nothing is handed back.
  4. Success: `giveBack` both keys.

  Both limit keys use `normaliseEmail(email)`.
- `loginAction` keeps its `LoginState` shape: zod check, then `signIn({ ..., ip: requestIp(await headers()), headers: await headers() })`, then `redirect("/dashboard")` on ok. `logoutAction`: `auth.api.signOut({ headers: await headers() })`, then `redirect("/login")`.

- [ ] **Step 1: Write the failing tests** in `tests/services/sign-in.test.ts`. Use a fresh `ip` per test.
  - The right password gives `ok: true` with a session cookie, and the `rate_limits` counts for both keys are 0 afterwards.
  - A wrong password gives `{ ok: false, error: "Email or password is incorrect" }` and no `session` row.
  - `" Admin@Shop.LK "` signs in a login stored as `admin@shop.lk` (Review Focus 1).
  - A turned-off profile gives the "turned off" copy and leaves 0 session rows for that user.
  - 10 wrong tries, then the right password with different case and spaces in the email gives "Too many tries…" (Review Focus 1: one counter).
  - 31 wrong tries from one ip across different emails: the 31st gives "Too many tries…".
  - 15 successful sign-ins in a row for one email all give `ok: true`.
  - `giveBack` never goes below 0.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/services/sign-in.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `giveBack` and `src/server/services/sign-in.ts`**, then rewrite `login/actions.ts` to use them (drop the Supabase import).

- [ ] **Step 4: Run them to verify they pass**, then `pnpm typecheck`.
Expected: remaining errors only in `users.ts` and `password-reset.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(auth): sign in through Better Auth with per-email and per-device limits"
```

---

### Task 5: Users and password reset on the new auth

**Files:**
- Modify: `src/server/services/users.ts`, `src/server/services/password-reset.ts`
- Test: `tests/services/users.test.ts`, `tests/services/password-reset.test.ts`

**Interfaces:**
- Consumes: `createLogin`, `setPassword`, `endSessions` (Task 2).
- Produces:
  - `createUser(user, input): Promise<{ id: string }>`. The `deps` parameter and the `AuthAdmin` type are removed. It keeps the existing profile-email duplicate check, then calls `createLogin`.
  - `setUserActive(user, userId, active)`: when `active` is false, it updates the profile and calls `endSessions` in one transaction.
  - `setUserPassword(user, userId, password, deps?: { now?: Date })`. The `PasswordAdmin` type is removed. In one transaction: delete reset codes, then `setPassword(userId, password, tx)`.
  - `ResetDeps = { send?: SendEmail; secret?: string }` (no `authAdmin`). `resetSecret` reads `BETTER_AUTH_SECRET` and throws `"BETTER_AUTH_SECRET is not set"`. Inside the existing transaction, `setPassword(user.id, input.newPassword, tx)` replaces the `signedOutAt` update and the Supabase call.

- [ ] **Step 1: Update the tests first**
  - Remove the Supabase fakes (`authAdmin`, the `passwords` array, `fakeAuthAdmin`). Make the users in these tests with `createLogin` where a password matters.
  - Where tests asserted `f.passwords` or `loadActiveUser(id, seconds)`, assert instead that:
    - `verifyPassword` on that user's `account.password` is true for the new password;
    - a session made with `signedInHeaders` before the change now gives null from `sessionUserFrom`.

    Move `signedInHeaders` to `tests/helpers/sessions.ts` and import it in the auth tests as well.
  - New: `setUserActive(admin, staff.id, false)` makes staff's existing session give null (Review Focus 4).
  - `createUser` test: the login can sign in with `signIn` (Task 4) using the chosen password.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/services/users.test.ts tests/services/password-reset.test.ts`
Expected: FAIL (compile errors or old behaviour).

- [ ] **Step 3: Implement** the Interfaces above. Remove `createSupabaseAdminClient` imports from both files.

- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`.
Expected: all unit tests pass. Typecheck reports nothing outside `scripts/` and `e2e/`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(auth): users and password reset write logins through Better Auth"
```

---

### Task 6: Middleware, Supabase auth removal, seed and e2e

**Files:**
- Modify: `src/middleware.ts`, `src/server/supabase.ts`, `scripts/seed.ts`, `e2e/global-setup.ts`, `e2e/users.ts` (comment), `package.json`
- Create: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `auth` (Task 3), `createLogin` / `setPassword` (Task 2).

- [ ] **Step 1: Write the middleware.**
  - `export const config = { runtime: "nodejs", matcher: [<the existing matcher, unchanged>] }`.
  - Body: `const { headers, response } = await auth.api.getSession({ headers: request.headers, returnHeaders: true })`.
  - No session (`response` null, or the call throws): redirect to `/login`, with search cleared as today.
  - Otherwise `NextResponse.next({ request })`, with every `headers.getSetCookie()` entry appended to `response.headers` as `Set-Cookie`.

- [ ] **Step 2: Trim `src/server/supabase.ts`** to `createSupabaseAdminClient` only, with the comment "Storage only (logo upload) until it moves off Supabase". Run `pnpm remove @supabase/ssr`.

- [ ] **Step 3: Seed.** In `scripts/seed.ts`, replace the Supabase block: if the profile exists, do nothing (as now); else `createLogin({ email, name: values["admin-name"], password, role: "admin" })`.

- [ ] **Step 4: e2e setup.** In `e2e/global-setup.ts`:
  1. After the migrate, truncate and base data (the truncate now also clears auth tables), set `process.env.DATABASE_URL = url`.
  2. Dynamic-import `../src/server/auth-admin` (it imports the shared `db` client, which reads `DATABASE_URL` at import).
  3. `createLogin` each `E2E_USERS` entry (`canGetEmails` true only for `reset`).
  4. Remove the `@supabase/supabase-js` import.

  Update the `e2e/users.ts` comment to "created through createLogin by global-setup".

- [ ] **Step 5: Write `e2e/auth.spec.ts`:**
  - Signed out, `/dashboard` redirects to `/login`.
  - Sign in as staff, sign out (sidebar form), then `/dashboard` redirects to `/login`.
  - A wrong password shows "Email or password is incorrect".
  - **Old Supabase cookie** (Review Focus 2): `context.addCookies([{ name: "sb-127-auth-token", value: "base64-eyJ4IjoxfQ", url }])`, then `/dashboard` lands on `/login` with a visible form and no console errors.
  - **Deleted session** (Review Focus 5): sign in, delete all `session` rows via a test DB client, then reload `/dashboard` lands on `/login`.
  - **Set password signs out another browser:** sign in as staff in context B. Admin in context A uses Users → Set password for staff (password `e2e-staff-pass-1`, unchanged, so other specs still work). Context B's next navigation lands on `/login`.
  - A turned-off login can't sign in. Create a fresh login in the spec through the Users page, turn it off, try to sign in, and expect the "turned off" copy. Don't turn off the shared staff login.

- [ ] **Step 6: Run the whole e2e suite**

Run: `pnpm test:e2e`
Expected: all specs pass, including `password-reset.spec.ts` and `permissions.spec.ts`.

- [ ] **Step 7: Production build check**

Run: `pnpm build` then `pnpm start`, pointed at local dev data.
Expected: the build passes. Signing in with a local login reaches the dashboard. Clicking Sales, Stock, Payments (Outstanding tab), Users and Settings works. Sign out works. A response after sign-in carries a `better-auth.session_token` cookie with `HttpOnly`, `SameSite=Lax`, and `Max-Age` ≈ 2592000.

- [ ] **Step 8: Lint, typecheck, unit tests, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: clean.

```bash
git add -A && git commit -m "feat(auth): middleware on Better Auth; drop Supabase login"
```

---

### Task 7: Login copy script and release notes

**Files:**
- Create: `scripts/ops/copy-supabase-logins.sql`, `docs/operations/better-auth-release.md`
- Modify: `docs/operations/password-reset.md` (the secret is now `BETTER_AUTH_SECRET`), `README.md` (env list / local logins, if they mention Supabase Auth)

- [ ] **Step 1: Write `scripts/ops/copy-supabase-logins.sql`.** One transaction. Header comment: what it does, that it only reads `auth.users`, and that it is safe to run again.
  - Upsert `"user"` from `profiles p join auth.users u on u.id = p.user_id` (`id = p.user_id`, `email = p.email`, `name = p.full_name`, `email_verified = true`, `created_at = p.created_at`), `on conflict (id) do update` email, name and `updated_at`.
  - Upsert `account` (`id = gen_random_uuid()`, `account_id = p.user_id::text`, `provider_id = 'credential'`, `user_id = p.user_id`, `password = u.encrypted_password`) for rows where `u.encrypted_password like '$2%'`, `on conflict (user_id, provider_id) do update set password = excluded.password, updated_at = now()`.
  - End with one check row: `select (select count(*) from profiles) profiles, (select count(*) from "user") users, (select count(*) from account where provider_id = 'credential' and password like '$2%') accounts`.

- [ ] **Step 2: Verify locally on the dev database** (local Supabase `postgres` db, where the dev logins still exist in `auth.users`):
  1. `pnpm db:migrate`.
  2. Run the script with `node` + `postgres` or `pnpm supabase db execute`. Expected check row: profiles = users = accounts.
  3. `pnpm dev` and sign in with a dev login's **existing** password. Expected: dashboard.
  4. Run the script again. Expected: same counts, no errors.

- [ ] **Step 3: Write `docs/operations/better-auth-release.md`:** spec §6 steps 1–7 as a checklist. Include:
  - the drizzle tracking-row SQL for 0012 (sha256 of `git show HEAD:drizzle/0012_better_auth.sql`, `created_at` = journal `when`);
  - the `openssl rand -hex 32` line for `BETTER_AUTH_SECRET`;
  - "tell staff they'll sign in once with the same password";
  - the "don't create logins on Preview before the release" rule;
  - the rollback command (`npx vercel@65.3.1 rollback <previous prod deployment>`);
  - "apply 0013 only after rollback is no longer wanted".

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(ops): copy existing logins into Better Auth; release checklist"
```

---

### Task 8 (later PR, only after production has run on Better Auth for a day or two): cleanup migration

**Files:**
- Modify: `src/server/db/schema/reference.ts` (`profiles.userId` `.references(() => user.id)`; remove `signedOutAt`)
- Create: `drizzle/0013_better_auth_cleanup.sql` (generated)

- [ ] **Step 1:** Make the schema change, then run `pnpm db:generate --name better_auth_cleanup`.
Expected: the SQL only adds the `profiles_user_id_user_id_fk` FK and drops `signed_out_at`.

- [ ] **Step 2:** Run `pnpm test && pnpm test:e2e`. Expected: pass (factories and `createLogin` already write `user` rows).

- [ ] **Step 3:** Before applying it to the cloud, run `select count(*) from profiles p left join "user" u on u.id = p.user_id where u.id is null`. Expected: 0. Then apply via MCP with its tracking row.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(db): profiles reference Better Auth users; drop signed_out_at"
```
