# Sparepartslk Stock & Billing MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cloud web app for a single-store B2B motorbike-parts seller. It covers catalog, GRN stock-in, low-stock list, tier-priced invoicing (A4/PDF/thermal), payments, returns and stock adjustments.

**Architecture:**
- Next.js 15 App Router monolith. Every write goes Server Action → `src/server/services/*`, inside one Drizzle transaction that locks the affected `parts` rows.
- Stock is an append-only `stock_movements` ledger plus a cached `parts.qty_on_hand`. A nightly SQL function reconciles the two.
- Supabase provides Postgres and Auth only. Data is accessed server-side through Drizzle, and RLS is enabled with no policies.

**Tech Stack:**
- App: Next.js 15, TypeScript (strict), Tailwind v4, shadcn/ui, zod
- Data: Drizzle ORM + drizzle-kit, `postgres` (postgres-js) driver, decimal.js
- Auth and Supabase: `@supabase/ssr`, `@supabase/supabase-js`, Supabase CLI (local, Docker)
- Output: `@react-pdf/renderer`
- Testing: Vitest, Playwright
- Package manager: pnpm

**Spec:** `docs/superpowers/specs/2026-10-22-stock-billing-mvp-design.md`. Read it before starting any task. Section numbers below (§) refer to it.

## Global Constraints

**Money, quantities, numbering**
- All money columns are `numeric(12,2)`. Drizzle columns use `mode: 'string'`. All arithmetic uses decimal.js through `src/lib/money.ts`. Never use JS number arithmetic on money.
- Rounding: half-up to 2 decimals (`Decimal.ROUND_HALF_UP`), applied at each line and at each total.
- Quantities are `integer`. `parts.qty_on_hand` has DB check `>= 0`. Item `qty` has check `> 0`.
- Primary keys are `uuid` (`defaultRandom()`). Every document table has `created_by uuid not null` (→ `profiles.user_id`) and `created_at timestamptz default now()`.
- Business dates use timezone `Asia/Colombo`. A document's year comes from its Colombo-local date.
- Document number format: `{TYPE}-{YYYY}-{000000}`, zero-padded to 6 digits. If `settings.doc_prefix` is non-empty, it is prepended with `-` (e.g. `SP-INV-2026-000123`). Types: `INV`, `GRN`, `CRN`, `PAY`, `ADJ`. Numbers have no gaps.

**Data integrity and security**
- Issued documents are never deleted. `stock_movements` is never updated or deleted.
- Negative stock is never allowed.
- Roles are `admin` and `staff`, enforced in every Server Action via `requireUser` / `requireRole` (Task 4). Responses to staff never include `avg_cost` or `unit_cost`.
- UI components never import `src/server/db/*`.
- RLS is enabled on every `public` table with no policies.

**Defaults**
- Seeded price tiers: `Retail` (default), `Dealer`, `Wholesale`.
- Seeded customer: `Walk-in Customer` (`is_walk_in = true`, credit_limit 0).
- Settings defaults: `vat_enabled = false`, `vat_rate = 18.00`, `staff_max_discount_pct = 10.00`, `default_credit_days = 30`, `doc_prefix = ''`.

**Platform**
- Windows dev machine. Requires Docker Desktop for `supabase start`. Use cross-platform npm scripts (no `rm -rf`, no `&&`-dependent env syntax; use `cross-env`).

## Review Focus

1. **Same part on two lines of one invoice.** The stock check must use the summed quantity. Two lines of 3 when 5 are in stock must fail. *Test: Task 10.*
2. **Part has no price for the customer's tier.** Fall back to the default tier's price. If neither exists, raise `PriceMissing`, never price at 0. *Test: Task 9.*
3. **Decimal rounding.** 3 × 33.33 with 10% line discount gives line_total `89.99`. VAT 18% on 89.99 gives `16.20`. Total equals the sum of the parts exactly. *Test: Task 9.*
4. **Year boundary in Colombo time.** A document created at `2026-12-31T19:00:00Z` (= 2027-01-01 00:30 Colombo) gets a `-2027-` number starting at 000001. *Test: Task 3.*
5. **Inactive records.** An inactive part or customer can't be invoiced (`InvalidState`). A deactivated user's session is rejected by `requireUser`. *Test: Tasks 4 and 10.*

---

## File Structure

```
package.json, tsconfig.json, next.config.ts, drizzle.config.ts, vitest.config.ts, playwright.config.ts, .env.example
supabase/config.toml                       (supabase init)
supabase/cron.sql                          pg_cron schedule (applied manually in prod)
drizzle/                                   generated + custom SQL migrations
scripts/seed.ts                            base data + first admin user
src/lib/money.ts                           Decimal helpers
src/lib/dates.ts                           Colombo date helpers
src/lib/amount-in-words.ts
src/lib/action-result.ts                   ActionResult type + toActionResult()
src/server/errors.ts                       DomainError subclasses
src/server/db/client.ts                    db, Tx, Executor types
src/server/db/schema/*.ts                  one file per area (reference, catalog, parties, documents, ledger)
src/server/auth.ts                         getSessionUser, requireUser, requireRole
src/server/supabase.ts                     server/admin Supabase clients
src/server/services/{sequences,inventory,catalog,grn,adjustments,pricing,customers,invoicing,payments,returns,settings,users,dashboard,print}.ts
src/server/actions/{catalog,grn,stock,customers,invoices,payments,returns,settings,users}.ts
src/middleware.ts                          Supabase session refresh + redirect to /login
src/app/(auth)/login/page.tsx
src/app/(app)/layout.tsx + one folder per screen (spec §7)
src/app/print/invoice/[id]/page.tsx
src/app/api/invoices/[id]/pdf/route.ts
src/components/ui/*  (shadcn)  src/components/{nav,billing,print,forms}/*
tests/setup/global-setup.ts                creates test DB + runs migrations
tests/helpers/{db,factories}.ts
tests/services/*.test.ts  tests/lib/*.test.ts  e2e/*.spec.ts
```

---

### Task 1: Project scaffold, tooling, local Supabase

**Files:**
- Create: the root config files listed above, `src/app/layout.tsx`, `src/app/page.tsx` (redirects to `/dashboard`), `tests/lib/smoke.test.ts`, `README.md` (setup steps)

**Interfaces:**
- Produces: pnpm scripts `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit`), `test` (vitest run), `test:e2e`, `db:generate`, `db:migrate`, `db:seed`
- Produces env vars (in `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/sparepartslk_test`

- [ ] **Step 1:** `pnpm create next-app@15 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm`. Add deps: `drizzle-orm postgres decimal.js zod @supabase/ssr @supabase/supabase-js @react-pdf/renderer`. Add dev deps: `drizzle-kit vitest @vitest/coverage-v8 @playwright/test tsx cross-env dotenv supabase`.
- [ ] **Step 2:** `pnpm dlx shadcn@latest init`, then add `button input label table dialog select form sonner badge card dropdown-menu command popover tabs textarea checkbox`.
- [ ] **Step 3:** `pnpm supabase init`, then `pnpm supabase start`. Copy the printed keys into `.env.local`.
- [ ] **Step 4:** Configure Vitest with `environment: 'node'`, `fileParallelism: false`, `globalSetup: tests/setup/global-setup.ts` and `setupFiles` loading `.env.local` + `.env.test`. Write `tests/lib/smoke.test.ts` asserting `1 + 1 === 2`. The global setup is a no-op until Task 2.
- [ ] **Step 5:** Run `pnpm test && pnpm typecheck && pnpm build`. Expected: all pass.
- [ ] **Step 6:** Add `.gitignore` entries `.env.local` and `.env.test`, then commit: `chore: scaffold Next.js app with Drizzle, Supabase, Vitest`.

---

### Task 2: Database schema, migrations, test DB harness

**Files:**
- Create: `src/server/db/client.ts`, `src/server/db/schema/{reference,catalog,parties,documents,ledger,index}.ts`, `drizzle/` migrations (including a custom one), `tests/setup/global-setup.ts`, `tests/helpers/db.ts`, `tests/services/schema.test.ts`

**Interfaces:**
- Produces in `client.ts`:
  - `db` (drizzle over postgres-js, `max: 10`)
  - `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]`
  - `type Executor = typeof db | Tx`
  - `client.ts` reads `TEST_DATABASE_URL` when `process.env.VITEST`, otherwise `DATABASE_URL`.
- Produces every table and column in spec §4, with these pinned additions:
  - `profiles.user_id` is a PK uuid with **no FK** to `auth.users`; profiles also has `email`.
  - `customers.is_walk_in boolean default false`.
  - `payments` gets `invoice_id uuid null` (set only on the auto cash payment created with an invoice), `is_refund boolean default false`, `status` enum `active|cancelled`, `return_id uuid null` (set on refunds).
  - `invoices.credit_override boolean default false`.
  - `sales_returns` gets `subtotal` and `total`.
  - `stock_adjustment_items` has `unit_cost`.
  - Enums: `role`, `payment_type`, `invoice_status`, `payment_method`, `movement_type`, `adjustment_reason` (`damage|count_correction|lost|other`), `doc_type`.
- Custom migration SQL:
  - `create extension if not exists pg_trgm`
  - gin trigram index on `parts.name`
  - `alter table … enable row level security` for every table
  - function `reconcile_stock() returns integer`. It inserts a mismatch row into `stock_reconciliation_issues` for each part whose `qty_on_hand <> coalesce(sum(qty_change),0)` and that has no unresolved issue, and returns the number inserted.
- Produces in `tests/helpers/db.ts`:
  - `resetDb(): Promise<void>`. Truncates all app tables with `restart identity cascade`, then inserts the 3 tiers, the walk-in customer and the settings row with the default values.
  - `withTestUser`: see Task 4.

- [ ] **Step 1: Write the failing test** `tests/services/schema.test.ts`:
  - `it('rejects negative qty_on_hand')`: insert a part, then `update parts set qty_on_hand = -1` rejects with a check violation (`code '23514'`).
  - `it('enforces unique sku')`: a second insert with the same sku rejects with `'23505'`.
  - `it('resetDb seeds defaults')`: 3 tiers exist, exactly one with `is_default` and name `Retail`; the walk-in customer exists; `settings.vat_rate === '18.00'`.
  - `it('reconcile_stock flags drift')`: insert a part with qty 5 and no movements; `select reconcile_stock()` returns 1, and a second call returns 0.
- [ ] **Step 2:** Run `pnpm test tests/services/schema.test.ts`. Expected: FAIL (no schema).
- [ ] **Step 3:** Write the schema files. Then:
  - Run `pnpm db:generate`, then `pnpm drizzle-kit generate --custom --name extras` and fill in the custom SQL.
  - `global-setup.ts` connects to the `postgres` DB, runs `create database sparepartslk_test` if missing, then runs drizzle `migrate()` against `TEST_DATABASE_URL`.
- [ ] **Step 4:** Run `pnpm test tests/services/schema.test.ts`. Expected: PASS. Also run `pnpm db:migrate` against the local dev DB. Expected: succeeds.
- [ ] **Step 5:** Commit: `feat(db): add full schema, migrations and test harness`.

---

### Task 3: Money, dates, errors, document sequences

**Files:**
- Create: `src/lib/money.ts`, `src/lib/dates.ts`, `src/server/errors.ts`, `src/lib/action-result.ts`, `src/server/services/sequences.ts`
- Test: `tests/lib/money.test.ts`, `tests/services/sequences.test.ts`

**Interfaces:**
- `money.ts`:
  - `D(x: string | number | Decimal): Decimal`
  - `round2(x: Decimal): Decimal`
  - `fmt(x: Decimal): string` (2dp string for the DB)
  - `sum(xs: Decimal[]): Decimal`
- `dates.ts`:
  - `colomboDate(at?: Date): string` (`YYYY-MM-DD`)
  - `colomboYear(at?: Date): number`
  - `addDays(date: string, n: number): string`
- `errors.ts`:
  - `class DomainError extends Error { code: string; field?: string; details?: Record<string, unknown> }`
  - Subclasses with code = class name: `InsufficientStock` (details `{partId, sku, available, requested}`), `CreditLimitExceeded` (`{balance, limit, invoiceTotal}`), `DiscountNotAllowed`, `ReturnQtyExceeded`, `PriceMissing` (`{partId, sku}`), `InvalidState`, `Forbidden`, `NotFound`
- `action-result.ts`:
  - `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; field?: string; details?: unknown } }`
  - `runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>>`. It maps `DomainError` to `ok:false`, maps `ZodError` to code `Validation`, and logs then rethrows everything else.
- `sequences.ts`:
  - `type DocType = 'INV'|'GRN'|'CRN'|'PAY'|'ADJ'`
  - `nextNumber(tx: Tx, docType: DocType, at?: Date): Promise<string>`. Implement with a single `insert … on conflict (doc_type, year) do update set next_no = document_sequences.next_no + 1 returning next_no`; that row lock is held until commit. Read `doc_prefix` from settings.

- [ ] **Step 1: Write failing tests:**
  - `round2(D('89.985')).toFixed(2) === '89.99'`
  - `colomboYear(new Date('2026-12-31T19:00:00Z')) === 2027`
  - `colomboDate(new Date('2026-10-21T20:00:00Z')) === '2026-10-22'`
  - sequences:
    - The first INV in 2026 is `'INV-2026-000001'` and the second is `'INV-2026-000002'`.
    - `at = new Date('2026-12-31T19:00:00Z')` gives `'INV-2027-000001'`.
    - With `doc_prefix='SP'`, the number is `'SP-INV-2026-000001'`.
    - A number taken in a transaction that then throws is reused by the next call (no gap).
    - 20 parallel `db.transaction(tx => nextNumber(tx,'GRN'))` calls give 20 distinct numbers covering exactly 1..20.
- [ ] **Step 2:** Run `pnpm test tests/lib tests/services/sequences.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the four modules.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add money/date utils, domain errors and gapless sequences`.

---

### Task 4: Auth, roles, app shell, seed

**Files:**
- Create: `src/server/supabase.ts`, `src/server/auth.ts`, `src/middleware.ts`, `src/app/(auth)/login/page.tsx` + `actions.ts`, `src/app/(app)/layout.tsx`, `src/components/nav/sidebar.tsx`, `scripts/seed.ts`
- Test: `tests/services/auth.test.ts`, `tests/helpers/factories.ts` (start it here)

**Interfaces:**
- `type Role = 'admin' | 'staff'`
- `type SessionUser = { id: string; email: string; fullName: string; role: Role }`
- `getSessionUser(): Promise<SessionUser | null>`. Calls Supabase `auth.getUser()`, then loads the profile. Returns null if there is no profile or `is_active=false`.
- `requireUser(): Promise<SessionUser>`. Throws `Forbidden` when the user is null.
- `requireRole(user: SessionUser, role: Role): void`. Throws `Forbidden` when role is admin and the user is not.
- `loadActiveUser(userId: string): Promise<SessionUser | null>`. The pure DB part, so it is testable without Supabase.
- `createSupabaseServerClient()` (cookies) and `createSupabaseAdminClient()` (service role, server only).
- `tests/helpers/factories.ts`: `makeUser(role: Role, overrides?) : Promise<SessionUser>` inserts a profile with a random uuid.
- Seed script (`pnpm db:seed -- --admin-email x --admin-password y`):
  - is idempotent
  - inserts the same base rows as `resetDb`
  - creates the Supabase auth user through the admin API, plus a matching `profiles` row with role admin

- [ ] **Step 1: Failing tests:**
  - `loadActiveUser` returns the role for an active profile.
  - It returns `null` when `is_active=false`.
  - `requireRole(staffUser,'admin')` throws `Forbidden`.
  - `requireRole(adminUser,'admin')` does not throw.
- [ ] **Step 2:** Run `pnpm test tests/services/auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the auth module.**
  - The middleware refreshes the session and redirects unauthenticated requests to `/login`. It matcher-excludes `/login`, `_next` and static files.
  - The login page uses an email/password form, a Server Action that calls `signInWithPassword`, then redirects to `/dashboard`.
  - `(app)/layout.tsx` calls `requireUser()` and renders the sidebar with these links: Dashboard, Billing (Invoices), Returns, Payments, Customers, Parts, Stock, Low Stock, GRN, Suppliers, Settings*, Users*. The links marked * are admin only. The low-stock count badge is filled in Task 8.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS. Then manual check: run `pnpm db:seed`, run `pnpm dev`, log in at `/login`, and confirm you land on `/dashboard` with the sidebar visible.
- [ ] **Step 5:** Commit: `feat(auth): Supabase login, role guard, app shell and seed`.

---

### Task 5: Catalog (parts, categories, brands, vehicle models, tier prices, fitments, search)

**Files:**
- Create: `src/server/services/catalog.ts`, `src/server/actions/catalog.ts`, `src/app/(app)/parts/{page,new/page,[id]/page}.tsx`, `src/components/forms/part-form.tsx`, a simple list+dialog CRUD inside `parts/settings` tabs for categories/brands/vehicle models
- Test: `tests/services/catalog.test.ts`; extend factories

**Interfaces:**
- `type PartInput = { sku; name; oemPartNo?; barcode?; categoryId?; brandId?; unit; binLocation?; reorderLevel: number; reorderQty: number; isActive: boolean; prices: { tierId: string; price: string }[]; fitmentIds: string[] }` (zod schema `partInputSchema` exported)
- `createPart(user: SessionUser, input: PartInput): Promise<{ id: string }>`. Admin only. New parts start with qty 0 and avg_cost 0.
- `updatePart(user, id, input): Promise<void>`. Admin only. It never touches `qty_on_hand` or `avg_cost`.
- `searchParts(q: string, opts?: { vehicleModelId?: string; activeOnly?: boolean; limit?: number }): Promise<PartListRow[]>`. Matching order:
  1. exact sku, barcode or oem number first
  2. then ILIKE prefix on sku/oem
  3. then trigram similarity on name
  `%` and `_` in `q` are escaped. Default limit is 20.
- `getPart(user, id): Promise<PartDetail>`. Includes prices, fitments and the last 50 movements.
- `toStaffView<T extends { avgCost?: string }>(user, row: T): T`. Strips `avgCost` / `unitCost` for staff. Reused by later tasks.
- CRUD: `listCategories / upsertCategory`, `listBrands / upsertBrand`, `listVehicleModels / upsertVehicleModel` (admin-only writes)
- Factory: `makePart(overrides?: Partial<PartInput> & { qty?: number; avgCost?: string }): Promise<{ id; sku }>`. Sets prices for all 3 tiers (default Retail 1000.00, Dealer 900.00, Wholesale 850.00). If qty is given, inserts a matching `ADJUST` movement so the ledger stays consistent.

- [ ] **Step 1: Failing tests:**
  - A staff user calling `createPart` gets `Forbidden`.
  - `searchParts('HON-123')` finds a part by its OEM number.
  - `searchParts('brake')` finds "Brake Shoe Pulsar 150".
  - `searchParts('', {vehicleModelId})` returns only parts fitted to that model.
  - `searchParts('50%')` does not throw and does not match everything.
  - `getPart(staff, id)` has no `avgCost` key.
  - `updatePart` ignores qty and avgCost fields.
- [ ] **Step 2:** Run `pnpm test tests/services/catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the services. Actions wrap them with `runAction`. Build the pages:
  - Parts list with a search box plus category/brand/vehicle filters.
  - Part form: identity fields, a price row per tier, and a fitment multi-select.
  - Part detail: prices, fitments and a movement history table.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS. Manual check: create a part in the UI and find it by OEM number.
- [ ] **Step 5:** Commit: `feat(catalog): parts, tier prices, fitments and search`.

---

### Task 6: Inventory core (locking, movements, average cost)

**Files:**
- Create: `src/server/services/inventory.ts`
- Test: `tests/services/inventory.test.ts`

**Interfaces:**
- `type LockedPart = { id; sku; name; qtyOnHand: number; avgCost: string; isActive: boolean }`
- `lockParts(tx: Tx, partIds: string[]): Promise<Map<string, LockedPart>>`. Runs `select … where id = any($1) order by id for update` on de-duplicated ids. Throws `NotFound` if any id is missing.
- `type MovementType = 'GRN'|'SALE'|'SALE_CANCEL'|'RETURN'|'ADJUST'`
- `applyMovement(tx, part: LockedPart, m: { type: MovementType; qtyChange: number; unitCost: string; refType: string; refId: string; userId: string; affectsAvgCost: boolean }): Promise<LockedPart>`.
  - Computes the new qty and throws `InsufficientStock` if it would be < 0.
  - If `affectsAvgCost && qtyChange > 0`, sets the new average using spec §5.3 (`newAvg = round2((oldQty*oldAvg + q*cost)/(oldQty+q))`; when oldQty = 0, newAvg = cost).
  - Updates `parts` and inserts a `stock_movements` row with `balance_after`.
  - Returns the updated `LockedPart`. The caller keeps it in the map, so several lines for one part chain correctly.
- `recalcAvgCost(oldQty: number, oldAvg: string, addQty: number, addCost: string): string` (pure)

- [ ] **Step 1: Failing tests:**
  - `recalcAvgCost(0,'0.00',10,'100.00') === '100.00'`
  - `recalcAvgCost(10,'100.00',10,'120.00') === '110.00'`
  - `recalcAvgCost(3,'33.33',1,'50.00') === '37.50'`
  - `applyMovement` with qtyChange −6 on qty 5 throws `InsufficientStock` with `details.available === 5`, and nothing is written.
  - A movement of +4 on qty 5 gives `balance_after === 9`, and `parts.qty_on_hand` becomes 9.
  - Two `applyMovement` calls on the same LockedPart (−2, −2 from 5) leave final qty 1 and balance_after values 3 then 1.
  - `lockParts` with a duplicate id returns a single entry.
- [ ] **Step 2:** Run `pnpm test tests/services/inventory.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(inventory): row locking, ledger movements, weighted average cost`.

---

### Task 7: Suppliers & GRN

**Files:**
- Create: `src/server/services/grn.ts`, `src/server/actions/grn.ts`, `src/app/(app)/suppliers/page.tsx`, `src/app/(app)/grn/{page,new/page,[id]/page}.tsx`, `src/components/forms/line-items-grid.tsx` (reusable part-search + qty grid, also used by invoices and adjustments)
- Test: `tests/services/grn.test.ts`; factory `makeSupplier()`

**Interfaces:**
- `listSuppliers()`, `upsertSupplier(user, input)` (both roles)
- `type GrnInput = { supplierId: string; supplierInvoiceNo?: string; receivedDate: string; note?: string; lines: { partId: string; qty: number; unitCost: string }[] }`
- `createGrn(user: SessionUser, input: GrnInput): Promise<{ id: string; number: string }>`. One transaction: `nextNumber('GRN')`, `lockParts`, `applyMovement` per line (type `GRN`, `affectsAvgCost: true`), and `total = Σ round2(qty*unitCost)`.
- `getGrn(user, id)`, `listGrns(filters)`. Staff see `unitCost` on GRNs they view, but never `parts.avgCost`.
- `lastSupplierForParts(partIds: string[]): Promise<Map<partId, { supplierId; supplierName }>>`. Used by Task 8.

- [ ] **Step 1: Failing tests:**
  - A GRN of 10 @ 100 on a new part gives qty 10 and avg_cost `'100.00'`, number `GRN-2026-000001` and one GRN movement.
  - A second GRN of 10 @ 120 gives avg `'110.00'`.
  - A GRN with a missing partId throws `NotFound` and leaves the sequence unconsumed (the next GRN is still 000001).
  - `lastSupplierForParts` returns the supplier from the most recent GRN.
- [ ] **Step 2:** Run `pnpm test tests/services/grn.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the services and UI. The GRN form uses `line-items-grid` with columns part search, qty and unit cost, and shows a running total.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(grn): suppliers and goods received notes`.

---

### Task 8: Stock list, adjustments, movement history, low stock

**Files:**
- Create: `src/server/services/adjustments.ts`, add `lowStock` and `stockList` to `inventory.ts`, `src/server/actions/stock.ts`, `src/app/(app)/stock/{page,adjustments/page,adjustments/new/page}.tsx`, `src/app/(app)/low-stock/page.tsx`, `src/app/api/low-stock/csv/route.ts`. Modify `src/components/nav/sidebar.tsx` (badge).
- Test: `tests/services/adjustments.test.ts`, `tests/services/low-stock.test.ts`

**Interfaces:**
- `type AdjustmentInput = { reason: 'damage'|'count_correction'|'lost'|'other'; note?: string; lines: { partId: string; qtyChange: number }[] }`
- `createAdjustment(user, input): Promise<{ id; number }>`.
  - Staff are allowed only `reason ∈ {damage, lost}` with every `qtyChange < 0`; otherwise `Forbidden`.
  - `qtyChange === 0` is rejected by zod.
  - Each movement is `ADJUST` with `unitCost = part.avgCost` and `affectsAvgCost: true` (positive count corrections enter at the current average, so the average is unchanged).
- `type LowStockRow = { partId; sku; name; qtyOnHand; reorderLevel; reorderQty; suggestedQty: number; lastSupplierId?: string; lastSupplierName?: string }`
- `lowStock(): Promise<LowStockRow[]>`. Rule: `is_active AND reorder_level > 0 AND qty_on_hand <= reorder_level`. `suggestedQty = reorderQty > 0 ? reorderQty : max(reorderLevel*2 - qtyOnHand, 1)`. Sorted by supplier name, then sku.
- `lowStockCount(): Promise<number>`
- `stockList(user, filters: { q?; categoryId?; lowOnly?: boolean })`. Staff get no cost. Admin also gets `stockValue = qty*avgCost`.
- CSV columns, in this order: `SKU,OEM No,Name,On Hand,Reorder Level,Suggested Qty,Last Supplier`.

- [ ] **Step 1: Failing tests:**
  - A staff `count_correction` +5 gives `Forbidden`.
  - A staff `damage` −2 succeeds: qty drops by 2 and an ADJ number is issued.
  - An admin adjustment of −10 on qty 3 throws `InsufficientStock`.
  - Low stock (qty 3, level 5, reorderQty 0) gives suggestedQty 7.
  - Qty 0, level 2, reorderQty 12 gives suggestedQty 12.
  - A part with level 0 is excluded.
  - An inactive part is excluded.
  - qty === level is included.
  - `lowStockCount()` equals `lowStock().length`.
- [ ] **Step 2:** Run `pnpm test tests/services/adjustments.test.ts tests/services/low-stock.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the services, pages, CSV route (`text/csv`, `Content-Disposition: attachment; filename=low-stock-YYYY-MM-DD.csv`) and the sidebar badge (`lowStockCount()` in the layout).
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(stock): adjustments, stock list and low-stock report`.

---

### Task 9: Customers & pricing engine

**Files:**
- Create: `src/server/services/customers.ts` (CRUD only here; balance and statement come in Task 13), `src/server/services/pricing.ts`, `src/server/actions/customers.ts`, `src/app/(app)/customers/{page,new/page,[id]/page}.tsx`
- Test: `tests/services/pricing.test.ts`, `tests/services/customers.test.ts`; factory `makeCustomer(overrides?)`

**Interfaces:**
- `type CustomerInput = { name; businessName?; phone?; address?; tin?; tierId; creditLimit: string; creditDays: number; isActive: boolean }`
- `createCustomer(user, input)` and `updateCustomer(user, id, input)`. Staff may create, but creditLimit must be `'0.00'`. Staff may edit contact fields only; changing `tierId`, `creditLimit` or `creditDays` gives `Forbidden`.
- `resolvePrices(tx: Executor, tierId: string, partIds: string[]): Promise<Map<partId, string>>`. Uses the tier price, else the default tier price, else throws `PriceMissing`.
- `type DiscountInput = { type: 'amount' | 'percent'; value: string }`
- `type PricedLineInput = { partId: string; qty: number; unitPrice: string; discount?: DiscountInput }`
- `computeTotals(lines: PricedLineInput[], invoiceDiscount: DiscountInput | undefined, vatRate: string /* '0' if VAT off */): Totals`
  - `Totals = { lines: { gross: string; discount: string; lineTotal: string }[]; subtotal: string; invoiceDiscount: string; vatAmount: string; total: string }`
  - Per line: `gross = qty*unitPrice`; percent discount `= round2(gross*pct/100)`; `lineTotal = round2(gross - discount)`.
  - `subtotal = Σ lineTotal`. The invoice discount is computed on the subtotal the same way.
  - `vatAmount = round2((subtotal - invoiceDiscount) * vatRate/100)`; `total = subtotal - invoiceDiscount + vatAmount`.
  - A discount greater than gross throws `DiscountNotAllowed`.
- `assertDiscountAllowed(user: SessionUser, totals: Totals, capPct: string): void`. For staff, every `line.discount <= round2(gross*cap/100)` and `invoiceDiscount <= round2(subtotal*cap/100)`; otherwise `DiscountNotAllowed`. Admin always passes.

- [ ] **Step 1: Failing tests (pricing):**
  - Dealer customer gets `'900.00'`.
  - A part with no Dealer price falls back to the Retail price.
  - No prices at all throws `PriceMissing` with the sku in details.
  - `computeTotals([{qty:3, unitPrice:'33.33', discount:{type:'percent',value:'10'}}], undefined, '18')` gives `lineTotal '89.99'`, `vatAmount '16.20'`, `total '106.19'`.
  - With VAT `'0'`, vatAmount is `'0.00'`.
  - An invoice discount of 5% on subtotal 1000 gives total 950.00 (no VAT).
  - Staff discount of 11% with cap 10 throws `DiscountNotAllowed`; 10% passes; admin at 50% passes.
- [ ] **Step 2: Failing tests (customers):**
  - A staff create with creditLimit `'5000.00'` gives `Forbidden`.
  - A staff update changing tierId gives `Forbidden`.
  - A staff update of the phone number succeeds.
- [ ] **Step 3:** Run `pnpm test tests/services/pricing.test.ts tests/services/customers.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement the services plus the customer list, form and detail pages. The detail page's statement section is a placeholder until Task 13.
- [ ] **Step 5:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(billing): customers and tier pricing engine`.

---

### Task 10: Create invoice (service)

**Files:**
- Create: `src/server/services/invoicing.ts`, add `customerBalance` to `src/server/services/customers.ts`
- Test: `tests/services/invoicing.test.ts`

**Interfaces:**
- `customerBalance(tx: Executor, customerId: string): Promise<string>`. Equals Σ(issued invoice total) − Σ(active payments.amount; refunds are negative) − Σ(sales_returns.total), per spec §4 "Derived values".
- `type InvoiceInput = { customerId: string; paymentType: 'cash' | 'credit'; invoiceDate?: string; lines: { partId: string; qty: number; discount?: DiscountInput }[]; invoiceDiscount?: DiscountInput; overrideCreditLimit?: boolean; cashPayment?: { method: 'cash'|'bank'|'cheque'; reference?: string } }`
- `createInvoice(user: SessionUser, input: InvoiceInput): Promise<{ id: string; number: string }>`. One transaction, in spec §5.1 order:
  1. load settings and the customer (inactive → `InvalidState`)
  2. walk-in + credit → `InvalidState`
  3. `resolvePrices` with the customer's tier
  4. `computeTotals` with `vatRate = settings.vat_enabled ? settings.vat_rate : '0'`
  5. `assertDiscountAllowed`
  6. `lockParts`. An inactive part → `InvalidState`. The **summed qty per part** must be ≤ qtyOnHand, else `InsufficientStock`.
  7. Credit check: `balance + total > creditLimit` → `CreditLimitExceeded`, unless an admin passes `overrideCreditLimit` (which sets `credit_override=true`). Staff passing the override → `Forbidden`.
  8. `nextNumber('INV')`
  9. Insert the invoice (snapshot `tier_id`, `vat_rate`; `due_date = invoiceDate + creditDays` for credit, else `invoiceDate`) and the items (`description = name`, `unit_cost = avgCost`).
  10. `applyMovement` `SALE` per line, `affectsAvgCost:false`
  11. For a cash sale, `nextNumber('PAY')`, insert a payment with amount = total and `invoice_id` = this invoice, and allocate it fully.

- [ ] **Step 1: Failing tests:**
  - **Happy credit invoice:**
    - number `INV-2026-000001`
    - stock 10→7
    - one SALE movement with balance_after 7
    - `invoice_items.unit_cost` equals the part's avgCost
    - due_date = date + 30
    - customer balance equals the total
  - **Cash invoice:** a PAY payment with `invoice_id` set, an allocation equal to the total, and balance `'0.00'`.
  - **Review Focus 1:** two lines of the same part, 3 + 3, with 5 on hand throws `InsufficientStock` with `requested 6`. Nothing is written and the INV sequence is not consumed.
  - **Concurrency:** qty 1, two `createInvoice` calls in parallel via `Promise.allSettled`. Exactly one is fulfilled, one is rejected with `InsufficientStock`, and the final qty is 0.
  - **Credit limit:**
    - credit limit 1000 with an existing balance of 800 and a new invoice of 300 → `CreditLimitExceeded`
    - the same with admin + override → success and `credit_override=true`
    - staff + override → `Forbidden`
  - **Review Focus 5:** an inactive customer → `InvalidState`; an inactive part → `InvalidState`.
  - **Walk-in:** walk-in + credit → `InvalidState`.
  - **VAT:** with VAT on (18%), the invoice stores `vat_rate '18.00'` and the correct vat_amount.
- [ ] **Step 2:** Run `pnpm test tests/services/invoicing.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS. Run it 3× to make sure the concurrency test is not flaky.
- [ ] **Step 5:** Commit: `feat(billing): transactional invoice creation with stock and credit checks`.

---

### Task 11: Billing UI (new invoice, list, detail)

**Files:**
- Create: `src/server/actions/invoices.ts`, `src/app/(app)/invoices/{page,new/page,[id]/page}.tsx`, `src/components/billing/{invoice-editor,customer-picker,part-search-command,totals-panel}.tsx`
- Add to `invoicing.ts`: `listInvoices(filters: { q?; customerId?; status?; from?; to?; outstandingOnly?: boolean })` and `getInvoice(user, id)`. Staff get no `unitCost`.
- Test: `tests/services/invoicing.test.ts` (list/get cases)

**Interfaces:**
- Action `previewInvoiceAction(input: InvoiceInput): Promise<ActionResult<Totals & { prices: Record<partId,string>; stock: Record<partId, number> }>>`. Calls `resolvePrices` + `computeTotals` with no writes; the editor uses it to show live totals.
- Action `createInvoiceAction(input): Promise<ActionResult<{ id; number }>>`. On success, redirect to `/invoices/[id]`.
- **Editor behaviour:**
  - The customer picker defaults to Walk-in.
  - `part-search-command` (shadcn Command) calls `searchParts` with a 200 ms debounce and shows sku, name, OEM, on-hand qty and the tier price.
  - Enter adds a line and focuses qty. Each line has a discount type toggle (%/Rs).
  - The `InsufficientStock` / `DiscountNotAllowed` / `CreditLimitExceeded` errors show inline, and admins see an "Override credit limit" confirm dialog.
  - Buttons: **Save**, **Save & Print A4**, **Save & Print Receipt**.
- The detail page shows the lines, totals, payment status (outstanding computed in Task 13; show total only until then) and buttons for Print A4 / Thermal / Download PDF.

- [ ] **Step 1: Failing tests:**
  - `listInvoices({ q: 'INV-2026-000002' })` returns that invoice.
  - `getInvoice(staff, id).items[0]` has no `unitCost`.
- [ ] **Step 2:** Run `pnpm test tests/services/invoicing.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the services, actions and UI.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS. Manual check in `pnpm dev`: create a credit invoice for a Dealer customer using only the keyboard, confirm the Dealer price is used and the stock on the part page dropped.
- [ ] **Step 5:** Commit: `feat(billing): invoice editor, list and detail pages`.

---

### Task 12: Invoice printing (A4, thermal, PDF)

**Files:**
- Create: `src/lib/amount-in-words.ts`, `src/server/services/print.ts`, `src/components/print/{invoice-a4,invoice-thermal}.tsx`, `src/components/print/invoice-pdf.tsx`, `src/app/print/invoice/[id]/page.tsx`, `src/app/api/invoices/[id]/pdf/route.ts`
- Test: `tests/lib/amount-in-words.test.ts`, `tests/services/print.test.ts`

**Interfaces:**
- `amountInWords(amount: string): string`
- `type InvoicePrintData = { business: { name; address; phone; email; tin; logoUrl }; title: 'TAX INVOICE' | 'INVOICE'; number; date; dueDate; paymentType; customer: { name; businessName; address; tin }; lines: { sku; description; qty; unitPrice; discount; lineTotal }[]; subtotal; invoiceDiscount; vatRate; vatAmount; total; amountInWords; preparedBy; status: 'issued' | 'cancelled' }`
- `getInvoicePrintData(user, id): Promise<InvoicePrintData>`. Title is `'TAX INVOICE'` when the invoice's snapshot `vat_rate > 0`, else `'INVOICE'`.
- **A4:** page at `?format=a4`, `@page { size: A4; margin: 12mm }`. The layout follows spec §7 "Invoice templates": a "CANCELLED" watermark when cancelled, and a signature line for "Received by". It auto-calls `window.print()` when `?autoprint=1`.
- **Thermal:** `?format=thermal`, `@page { size: 80mm auto; margin: 3mm }`, body width 72mm, monospace 11px, lines as `desc` then `qty x price = total`.
- **PDF:** the route returns `application/pdf` with `Content-Disposition: inline; filename=<number>.pdf`, rendered from the same `InvoicePrintData`.

- [ ] **Step 1: Failing tests:**
  - `amountInWords('1250.50') === 'Rupees One Thousand Two Hundred Fifty and Cents Fifty Only'`
  - `amountInWords('100000.00') === 'Rupees One Hundred Thousand Only'`
  - `amountInWords('0.75') === 'Rupees Zero and Cents Seventy Five Only'`
  - `getInvoicePrintData`:
    - title is `'TAX INVOICE'` and customer.tin is present when VAT is on
    - title is `'INVOICE'` when VAT is off
    - after cancel (Task 13 not yet built, so set status directly in the test) status is `'cancelled'`
- [ ] **Step 2:** Run `pnpm test tests/lib/amount-in-words.test.ts tests/services/print.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use international numbering words (thousand / million), not lakh.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS. Manual check: open `/print/invoice/<id>?format=a4` and `?format=thermal` in Chrome print preview (A4 and 80mm paper); `/api/invoices/<id>/pdf` downloads a PDF with the same totals.
- [ ] **Step 5:** Commit: `feat(print): A4, 80mm thermal and PDF invoices`.

---

### Task 13: Payments, outstanding/overdue, customer statement, cancel invoice

**Files:**
- Create: `src/server/services/payments.ts`, `src/server/actions/payments.ts`, `src/app/(app)/payments/{page,new/page}.tsx`. Add `cancelInvoice` to `invoicing.ts`, `invoiceOutstanding`, `outstandingInvoices`, `customerStatement` to `customers.ts`, and a cancel dialog to the invoice detail page.
- Test: `tests/services/payments.test.ts`, `tests/services/cancel-invoice.test.ts`

**Interfaces:**
- `invoiceOutstanding(tx, invoiceIds: string[]): Promise<Map<id, { settled: string; outstanding: string }>>`. Per spec §4: `settled = min(total, Σ active allocations + Σ credit notes)`.
- `type OutstandingRow = { invoiceId; number; customerId; customerName; invoiceDate; dueDate; total; outstanding; daysOverdue: number }`
- `outstandingInvoices(filters: { customerId?; overdueOnly?: boolean }): Promise<OutstandingRow[]>`. Ordered by due_date. `daysOverdue = max(0, today − dueDate)` in Colombo time.
- `type PaymentInput = { customerId; amount: string; method: 'cash'|'bank'|'cheque'; reference?: string; paymentDate?: string; allocations?: { invoiceId: string; amount: string }[] }`
  - `reference` is required when the method is not cash (zod).
- `receivePayment(user, input): Promise<{ id; number; unapplied: string }>`.
  - Without `allocations`, payments auto-allocate oldest due first (`due_date, invoice_date, number`) up to each invoice's outstanding amount.
  - Explicit `allocations` are admin only (staff → `Forbidden`). Each must be ≤ that invoice's outstanding amount and Σ ≤ amount, else `InvalidState`.
- `customerStatement(customerId, from?, to?): Promise<{ opening: string; rows: { date; type: 'INVOICE'|'PAYMENT'|'CREDIT_NOTE'|'REFUND'; number; debit: string; credit: string; balance: string }[]; closing: string }>`
- `cancelInvoice(user, invoiceId, reason: string): Promise<void>`.
  - Admin only. Reason must be non-empty.
  - The invoice must be `issued`, have no `sales_returns`, and have no active allocations from payments whose `invoice_id` ≠ this invoice. Otherwise `InvalidState`.
  - Steps: cancel its own auto payment (`status='cancelled'`), lock the parts, then `applyMovement` `SALE_CANCEL` per line with `+qty`, `unitCost = item.unit_cost`, `affectsAvgCost: true`.
  - Set status, `cancel_reason`, `cancelled_by`, `cancelled_at`.
- Pages:
  - **Payments list**, and a **new payment** form (customer → shows its open invoices and auto-allocation preview).
  - An **Outstanding** tab with an overdue-only toggle.
  - **Customer detail** now shows the statement and balance.
  - The **invoice detail** shows outstanding.

- [ ] **Step 1: Failing tests (payments):**
  - Two credit invoices, 1000 (due earlier) and 500. Paying 1200 settles the first fully and the second by 200, with outstanding `'0.00'` and `'300.00'`. `unapplied '0.00'`.
  - Paying 2000 leaves unapplied `'500.00'` and a customer balance of `'-500.00'`.
  - A cheque without a reference gives a Validation error.
  - Staff explicit allocations give `Forbidden`.
  - An allocation greater than outstanding gives `InvalidState`.
  - `outstandingInvoices({overdueOnly:true})` includes an invoice due yesterday and excludes one due today.
  - The statement's closing balance equals `customerBalance`.
- [ ] **Step 2: Failing tests (cancel):**
  - Cancelling a credit invoice with qty 3 restores the stock and creates a SALE_CANCEL movement. Status is `cancelled`, the balance drops by the total, and the next invoice number is still the next sequential one.
  - Cancelling a cash invoice also cancels its auto payment and leaves balance `'0.00'`.
  - Cancelling an invoice that has a separate payment allocated gives `InvalidState`.
  - Staff → `Forbidden`.
  - An empty reason gives Validation.
- [ ] **Step 3:** Run `pnpm test tests/services/payments.test.ts tests/services/cancel-invoice.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement the services and UI.
- [ ] **Step 5:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(billing): payments, receivables, statements and invoice cancellation`.

---

### Task 14: Sales returns / credit notes

**Files:**
- Create: `src/server/services/returns.ts`, `src/server/actions/returns.ts`, `src/app/(app)/returns/{page,new/page,[id]/page}.tsx`. Add a "Return items" button on the invoice detail page that links to `/returns/new?invoiceId=`.
- Test: `tests/services/returns.test.ts`

**Interfaces:**
- `type ReturnInput = { invoiceId: string; reason: string; lines: { invoiceItemId: string; qty: number; restock: boolean }[]; refund?: { method: 'cash'|'bank'; reference?: string } }`
- `createReturn(user, input): Promise<{ id; number; refundPaymentId?: string }>`. One transaction:
  1. The invoice must be `issued`, else `InvalidState`.
  2. Per line, `qty ≤ item.qty − Σ previously returned` (else `ReturnQtyExceeded`).
  3. Return line `lineTotal = round2(qty × item.line_total / item.qty)`.
  4. Return `subtotal = Σ lineTotal`, then `total = round2(subtotal × invoice.total / invoice.subtotal)`. This factor carries the invoice discount and VAT, resolving a spec §5.4 silence.
  5. `nextNumber('CRN')`. Restocked lines get `applyMovement` `RETURN` with `+qty`, `unitCost = item.unit_cost`, `affectsAvgCost:true`.
  6. If `refund` is given: `nextNumber('PAY')`, then a payments row with `amount = −total`, `is_refund=true` and `return_id`. A refund is **required** when the customer is walk-in (else `InvalidState`).

- [ ] **Step 1: Failing tests:**
  - Selling 5 and returning 2 with restock restores stock by 2 and creates a RETURN movement. The CRN number is `CRN-2026-000001`, and the invoice outstanding and customer balance drop by the return total.
  - Returning 4 more after 2 (sold 5) gives `ReturnQtyExceeded`.
  - Damaged (`restock:false`) gives the credit but no stock change and no movement.
  - Proportional values: 3 × 33.33, 10% line discount, VAT 18%, invoice total 106.19. Returning 1 gives lineTotal `'30.00'` and total `round2(30.00 × 106.19/89.99) = '35.40'`.
  - A return on a cancelled invoice gives `InvalidState`.
  - A walk-in return without a refund gives `InvalidState`.
  - A walk-in return with a cash refund leaves the walk-in balance at `'0.00'` and the statement showing a REFUND row.
- [ ] **Step 2:** Run `pnpm test tests/services/returns.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The return form loads the invoice lines with their returnable qty, and has a restock checkbox (default on) and a refund section.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(billing): sales returns, credit notes and refunds`.

---

### Task 15: Settings & user management

**Files:**
- Create: `src/server/services/{settings,users}.ts`, `src/server/actions/{settings,users}.ts`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/users/page.tsx`
- Test: `tests/services/settings.test.ts`, `tests/services/users.test.ts`

**Interfaces:**
- `getSettings(): Promise<Settings>`
- `updateSettings(user, input: SettingsInput): Promise<void>`. Admin only. `vat_rate` is 0–100. `staff_max_discount_pct` is 0–100. `doc_prefix` matches `^[A-Z0-9]{0,6}$`. The logo is uploaded to Supabase Storage bucket `branding` (public) and `logo_url` is stored.
- `createUser(user, { email; fullName; role; password }): Promise<{ id }>`. Admin only. Uses `createSupabaseAdminClient().auth.admin.createUser({ email, password, email_confirm: true })` and inserts the profile. Tests inject the admin client via an optional `deps` parameter so they don't hit Supabase.
- `setUserActive(user, userId, active: boolean)`. An admin can't deactivate themself (`InvalidState`).
- `setUserRole(user, userId, role)`. The last active admin can't be demoted (`InvalidState`).

- [ ] **Step 1: Failing tests:**
  - Staff `updateSettings` gives `Forbidden`.
  - `vat_rate '120'` gives Validation.
  - After enabling VAT, a new invoice gets the title TAX INVOICE (reuse `getInvoicePrintData`).
  - `createUser` with a fake admin client inserts a profile with the chosen role.
  - Demoting the only admin gives `InvalidState`.
  - Self-deactivation gives `InvalidState`.
- [ ] **Step 2:** Run `pnpm test tests/services/settings.test.ts tests/services/users.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the services and pages.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(admin): settings and user management`.

---

### Task 16: Dashboard & stock reconciliation

**Files:**
- Create: `src/server/services/dashboard.ts`, `src/app/(app)/dashboard/page.tsx`, `supabase/cron.sql`
- Test: `tests/services/dashboard.test.ts`

**Interfaces:**
- `getDashboard(user): Promise<{ todaySales: string; todayInvoiceCount: number; lowStockCount: number; totalOutstanding: string; totalOverdue: string; reconciliationIssues?: { partId; sku; storedQty; ledgerQty; detectedAt }[] }>`
  - `todaySales` = Σ issued invoice totals where `invoice_date = colomboDate()`.
  - `reconciliationIssues` are included for admin only (unresolved rows).
- `resolveReconciliationIssue(user, issueId)`. Admin only; sets `resolved_at`. The admin fixes the stock with a count_correction adjustment first.
- `supabase/cron.sql`: `select cron.schedule('reconcile-stock', '30 20 * * *', $$select public.reconcile_stock()$$);` (20:30 UTC = 02:00 Colombo). Applied manually in the Supabase SQL editor; see README.

- [ ] **Step 1: Failing tests:**
  - Two invoices today (one cancelled) and one yesterday → todaySales counts only today's issued invoice and todayInvoiceCount is 1.
  - totalOverdue counts only invoices past due.
  - Staff dashboard has no `reconciliationIssues` key.
  - After a manual `update parts set qty_on_hand = qty_on_hand + 1` and `select reconcile_stock()`, the admin dashboard lists 1 issue.
- [ ] **Step 2:** Run `pnpm test tests/services/dashboard.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The dashboard is stat cards (numbers only, no charts), with a quick link to New Invoice and an admin-only warning card for reconciliation issues.
- [ ] **Step 4:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(dashboard): daily stats and stock reconciliation`.

---

### Task 17: End-to-end tests, README, deployment

**Files:**
- Create: `e2e/global-setup.ts` (reset the test DB, seed, create `admin@test.local` / `staff@test.local` through the local Supabase admin API), `e2e/full-flow.spec.ts`, `e2e/permissions.spec.ts`
- Modify: `README.md`, `playwright.config.ts` (webServer `pnpm dev` with `DATABASE_URL=$TEST_DATABASE_URL`)

**Interfaces:**
- Consumes all pages from Tasks 4–16.

- [ ] **Step 1: Write `e2e/full-flow.spec.ts`:**
  1. Admin logs in.
  2. Admin creates a part `BRK-001` (Retail 1000, Dealer 900), reorder level 5, and a Dealer customer with credit limit 50000.
  3. Admin creates a GRN of 10 @ 600.
  4. Staff logs in and creates a credit invoice of 6 × BRK-001 for the Dealer customer. Expect total `5,400.00` and the invoice number `INV-2026-000001` visible.
  5. Open `/print/invoice/<id>?format=a4`: the text contains `INVOICE` and `5,400.00`. With `?format=thermal`, the page renders.
  6. Low Stock page lists `BRK-001` (qty 4 ≤ 5).
  7. Receive a 3000 cash payment: the invoice outstanding shows `2,400.00`.
  8. Return 1 with restock: stock is 5, and BRK-001 is still on Low Stock (5 ≤ 5).
- [ ] **Step 2: Write `e2e/permissions.spec.ts`:**
  - Staff do not see the Settings and Users links.
  - Staff visiting `/settings` are redirected or shown 403.
  - The staff part detail page shows no "Avg Cost" text.
- [ ] **Step 3:** Run `pnpm test:e2e`. Expected: both specs pass. Fix any defects found in the owning task's code, with a regression unit test.
- [ ] **Step 4: Update the README**, covering:
  - prerequisites (Node 20+, pnpm, Docker Desktop)
  - local setup (`supabase start`, env, `db:migrate`, `db:seed`)
  - test commands
  - production deploy: create a Supabase project, set Vercel env vars, run `pnpm db:migrate` with `DIRECT_URL`, `pnpm db:seed` for the first admin, run `supabase/cron.sql`, create the `branding` bucket
  - the IRD tax-invoice compliance note from spec §2
- [ ] **Step 5:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: all pass.
- [ ] **Step 6:** Commit: `test(e2e): full billing flow and permissions; docs: setup and deploy`.
