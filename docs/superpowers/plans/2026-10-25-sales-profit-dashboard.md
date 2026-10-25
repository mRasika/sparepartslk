# Sales & Profit Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "Sales & profit" section to `/dashboard` with period presets + custom range, KPI tiles with comparison, a sales/profit trend chart, a cash-vs-credit split and top-10 sellers by part, category, brand and bike model.

**Architecture:** Pure period logic in `src/lib/periods.ts`; live SQL aggregates in `src/server/services/sales-analytics.ts` (admin-checked); a server-rendered section driven by URL search params, with two small client components (period picker, chart). No new tables; one new index.

**Tech Stack:** Next.js 15 App Router (server components), Drizzle ORM on Supabase Postgres, Vitest (service tests against local Supabase), Playwright, shadcn/ui (`base-nova` style) + new shadcn `chart` component (Recharts).

**Spec:** `docs/superpowers/specs/2026-10-25-sales-profit-dashboard-design.md` — read it first; §3 (definitions) and §4 (periods) are the source of truth for every number.

## Global Constraints

- Admin only: `getSalesAnalytics` calls `requireRole(user, "admin")`; the page renders the section only when `user.role === "admin"`. Staff must never receive cost or profit data.
- Business dates are Colombo time via `colomboDate()` (`src/lib/dates.ts`); weeks start on Monday.
- Money stays as 2-decimal strings / `Decimal` via `@/lib/money` (`D`, `fmt`, `round2`, `sum`); format for display with `formatMoney` and an `Rs ` prefix like the existing tiles.
- Only `invoices.status = 'issued'` count. VAT is never part of sales.
- Invalid or missing period params fall back to **This month**; custom range: `from ≤ to ≤ today`, at most 3 years (≤ 1096 days inclusive).
- Copy, exactly: section heading `Sales & profit`; presets `This week`, `This month`, `Last month`, `Last 3 months`, `This year`, `Custom`; tiles `Net sales`, `Gross profit`, `Margin`, `Avg sale`; `No sales before`; `No sales in this period`; `Couldn't load sales figures`; `Uncategorised`; `No brand`; tabs `Parts`, `Categories`, `Brands`, `Bike models`; sort `Sales`, `Profit`.
- Code style: match the surrounding files (short JSDoc on exported functions, Drizzle `sql` templates, `@/` imports).

## Review Focus

1. **Invoice with subtotal 0** (100% discount or zero-price lines) — no division-by-zero error; it counts as Rs 0 sales but its cost still counts. Test in Task 2.
2. **Hand-edited URL** (`?period=foo`, `?from=2026-02-30&to=…`, `from` without `to`, `from > to`, `to` in the future, 4-year range) — page shows This month, never a 500. Tests in Task 1.
3. **Period with only returns** (net sales negative) — margin shows `—`, change tiles don't crash, chart draws a negative bar. Tests in Tasks 2 and 4.
4. **Comparison period with no sales** — tile shows `No sales before`, not `Infinity%`/`NaN%`. Test in Task 4.
5. **Switching periods keeps the Today part on screen** — the sales section suspends on its own (Suspense `key` = query string), so the route-level `loading.tsx` doesn't blank the whole page. Checked in Task 5's e2e (Today heading stays visible after clicking a preset).

---

### Task 1: Period resolution

**Files:**
- Create: `src/lib/periods.ts`
- Test: `tests/lib/periods.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PeriodPreset = "week" | "month" | "last-month" | "3-months" | "year";
  export type Bucket = "day" | "week" | "month";
  export type DateRange = { from: string; to: string }; // inclusive, YYYY-MM-DD
  export type Period = { preset: PeriodPreset | "custom"; range: DateRange; compare: DateRange; bucket: Bucket };
  export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[]; // in the order of Global Constraints
  export function resolvePeriod(params: { period?: string; from?: string; to?: string }, today?: string): Period; // today defaults to colomboDate()
  export function formatRange(r: DateRange, today?: string): string;
  ```

- [ ] **Step 1: Write the failing tests** (all with an explicit `today`)

```ts
const T = "2026-10-25"; // a Sunday
it("defaults to this month", () =>
  expect(resolvePeriod({}, T)).toEqual({ preset: "month", range: { from: "2026-10-01", to: T }, compare: { from: "2026-09-01", to: "2026-09-25" }, bucket: "day" }));
it("this week starts on Monday", () =>
  expect(resolvePeriod({ period: "week" }, T)).toMatchObject({ range: { from: "2026-10-19", to: T }, compare: { from: "2026-10-12", to: "2026-10-18" }, bucket: "day" }));
it("this week on a Monday is one day", () =>
  expect(resolvePeriod({ period: "week" }, "2026-10-19").range).toEqual({ from: "2026-10-19", to: "2026-10-19" }));
it("last month is full and compares with the month before", () =>
  expect(resolvePeriod({ period: "last-month" }, T)).toMatchObject({ range: { from: "2026-09-01", to: "2026-09-30" }, compare: { from: "2026-08-01", to: "2026-08-31" }, bucket: "day" }));
it("last 3 months is rolling and grouped by week", () =>
  expect(resolvePeriod({ period: "3-months" }, T)).toMatchObject({ range: { from: "2026-07-26", to: T }, compare: { from: "2026-04-25", to: "2026-07-25" }, bucket: "week" }));
it("this year compares with the same dates last year", () =>
  expect(resolvePeriod({ period: "year" }, T)).toMatchObject({ range: { from: "2026-01-01", to: T }, compare: { from: "2025-01-01", to: "2025-10-25" }, bucket: "month" }));
it("clamps this month's comparison to the previous month's end", () =>
  expect(resolvePeriod({ period: "month" }, "2027-03-31").compare).toEqual({ from: "2027-02-01", to: "2027-02-28" }));
it("maps Feb 29 to Feb 28 last year", () =>
  expect(resolvePeriod({ period: "year" }, "2028-02-29").compare).toEqual({ from: "2027-01-01", to: "2027-02-28" }));
it("custom range compares with the same number of days before", () =>
  expect(resolvePeriod({ from: "2026-08-01", to: "2026-09-15" }, T)).toEqual({ preset: "custom", range: { from: "2026-08-01", to: "2026-09-15" }, compare: { from: "2026-06-16", to: "2026-07-31" }, bucket: "week" }));
it.each([[31, "day"], [32, "week"], [92, "week"], [93, "month"]])("custom %i days groups by %s", (days, bucket) =>
  expect(resolvePeriod({ from: addDays(T, -(days - 1)), to: T }, T).bucket).toBe(bucket));
it("custom wins over period", () => expect(resolvePeriod({ period: "year", from: "2026-10-01", to: "2026-10-02" }, T).preset).toBe("custom"));
it.each([
  [{ period: "foo" }], [{ from: "2026-02-30", to: "2026-03-01" }], [{ from: "2026-10-01" }],
  [{ from: "2026-10-10", to: "2026-10-01" }], [{ from: "2026-10-01", to: "2026-10-26" }],
  [{ from: "2022-01-01", to: "2026-10-01" }], [{ from: "not-a-date", to: T }],
])("falls back to this month for %j", (params) => expect(resolvePeriod(params, T).preset).toBe("month"));
it("accepts exactly 3 years", () => expect(resolvePeriod({ from: "2023-10-27", to: T }, T).preset).toBe("custom"));
it.each([
  [{ from: "2026-09-01", to: "2026-09-25" }, "Sep 1–25"],
  [{ from: "2026-08-01", to: "2026-09-15" }, "Aug 1 – Sep 15"],
  [{ from: "2025-01-01", to: "2025-10-25" }, "Jan 1 – Oct 25, 2025"],
  [{ from: "2025-12-29", to: "2026-01-04" }, "Dec 29, 2025 – Jan 4, 2026"],
  [{ from: "2026-10-19", to: "2026-10-19" }, "Oct 19"],
])("formats %j as %s", (r, s) => expect(formatRange(r, T)).toBe(s));
```

- [ ] **Step 2: Run to verify they fail** — `pnpm test tests/lib/periods.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/periods.ts`.** Do date maths on `YYYY-MM-DD` strings in UTC (reuse `addDays` from `@/lib/dates`; add a local `addMonths` that clamps to month end). Validate a date by round-tripping it through `Date` (rejects `2026-02-30`). 3-year limit: inclusive length ≤ 1096 days. `formatRange` omits the year when both ends are in `today`'s year, and omits the repeated month when both ends share a month and year.
- [ ] **Step 4: Run to verify they pass** — `pnpm test tests/lib/periods.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/periods.ts tests/lib/periods.test.ts && git commit -m "feat(dashboard): resolve sales periods and their comparison ranges"`

---

### Task 2: Sales totals and trend (service + index)

**Files:**
- Modify: `src/server/db/schema/documents.ts` (add `index("sales_returns_return_date_idx").on(t.returnDate)` to `salesReturns`)
- Create: `drizzle/0007_*.sql` + snapshot via `pnpm db:generate`
- Create: `src/server/services/sales-analytics.ts`
- Test: `tests/services/sales-analytics.test.ts`

**Interfaces:**
- Consumes: `DateRange`, `Bucket`, `Period` from Task 1.
- Produces:
  ```ts
  export type SalesTotals = {
    netSales: string;      // invoice net sales − return net amounts
    cost: string;          // invoice line costs − restocked return costs
    grossProfit: string;   // netSales − cost
    invoiceSales: string;  // invoice net sales only (for Avg sale and the cash/credit split)
    invoiceCount: number;
    cashSales: string;
    creditSales: string;
  };
  export type TrendPoint = { bucketStart: string; netSales: string; grossProfit: string };
  export async function getSalesTotals(range: DateRange): Promise<SalesTotals>;
  export async function getSalesTrend(range: DateRange, bucket: Bucket): Promise<TrendPoint[]>;
  ```

**SQL shape (both functions build on one "sale lines" CTE, written once as a private helper returning a `sql` fragment):**
```sql
-- invoice lines in range
select i.invoice_date as d, ii.part_id, ii.qty,
       case when i.subtotal = 0 then 0 else ii.line_total * (i.subtotal - i.discount_total) / i.subtotal end as net,
       ii.unit_cost * ii.qty as cost
from invoice_items ii join invoices i on i.id = ii.invoice_id
where i.status = 'issued' and i.invoice_date between $from and $to
union all
-- return lines in range (negative)
select r.return_date, ri.part_id, -ri.qty,
       -(case when i.subtotal = 0 then 0 else ri.line_total * (i.subtotal - i.discount_total) / i.subtotal end),
       -(case when ri.restock then ii.unit_cost * ri.qty else 0 end)
from sales_return_items ri join sales_returns r on r.id = ri.return_id
join invoices i on i.id = r.invoice_id join invoice_items ii on ii.id = ri.invoice_item_id
where r.return_date between $from and $to
```
`invoiceSales`, `invoiceCount`, `cashSales`, `creditSales` come from the `invoices` headers (`subtotal − discount_total`, filtered by `payment_type`), not from the CTE. Round sums to 2 decimals in SQL (`::numeric(12,2)::text`) like `dashboard.ts`. Trend: `generate_series(date_trunc(bucket, from), to, '1 bucket')` left-joined to the CTE grouped by `date_trunc(bucket, d)`; `bucketStart = greatest(bucket_start, from)`; empty buckets are `"0.00"`.

- [ ] **Step 1: Write the failing tests.** Use `resetDb`, `makeUser`, `makeCustomer({ creditLimit: "100000.00" })`, `makePart({ qty, avgCost })` (Retail price 1000.00), `createInvoice`, `cancelInvoice`, `createReturn`. Use explicit ranges around `today = colomboDate()`; invoices may be back-dated with `invoiceDate`; returns are always dated today.
  - `excludes cancelled invoices and VAT`: VAT on (`db.update(settings).set({ vatEnabled: true, vatRate: "18.00" })`); part avgCost `600.00`; one cash invoice qty 2 today, one cancelled → `{ netSales: "2000.00", cost: "1200.00", grossProfit: "800.00", invoiceSales: "2000.00", invoiceCount: 1, cashSales: "2000.00", creditSales: "0.00" }`.
  - `takes off the invoice discount`: credit invoice qty 3, `invoiceDiscount: { type: "amount", value: "300" }` → `netSales "2700.00"`, `creditSales "2700.00"`.
  - `counts a return on its own date`: credit invoice qty 4 (avgCost 600) dated `addDays(today, -40)`; two separate `createReturn` calls today, 1 with `restock: true` and 1 with `restock: false`. Range `{ from: addDays(today, -40), to: addDays(today, -40) }` → `netSales "4000.00"`, `cost "2400.00"`. Range `{ from: today, to: today }` → `netSales "-2000.00"`, `cost "-600.00"`, `grossProfit "-1400.00"`, `invoiceCount 0`.
  - `handles a zero-subtotal invoice`: invoice with `invoiceDiscount: { type: "percent", value: "100" }` (admin) qty 1 avgCost 600 → `netSales "0.00"`, `cost "600.00"`, no error.
  - `fills empty days with zero`: one invoice today, range `{ from: addDays(today, -2), to: today }`, bucket `day` → 3 points, first two `netSales "0.00"`, last `"1000.00"`.
  - `starts weekly buckets on Monday but not before the range`: range from a Wednesday → first `bucketStart` is that Wednesday, second is the next Monday.
  - `groups by month`: two invoices in different months (back-dated) → one point per month with the right sums.
- [ ] **Step 2: Run to verify they fail** — `pnpm test tests/services/sales-analytics.test.ts` → FAIL (module not found).
- [ ] **Step 3: Add the index and generate the migration** — edit the schema, run `pnpm db:generate`, check the new `drizzle/0007_*.sql` contains only `CREATE INDEX "sales_returns_return_date_idx" ...`, then `pnpm db:migrate` against local Supabase.
- [ ] **Step 4: Implement `getSalesTotals` and `getSalesTrend`** per the SQL shape above.
- [ ] **Step 5: Run to verify they pass** — `pnpm test tests/services/sales-analytics.test.ts` → PASS; `pnpm test tests/services/schema.test.ts` still PASS.
- [ ] **Step 6: Commit** — `git add src/server/db/schema/documents.ts drizzle src/server/services/sales-analytics.ts tests/services/sales-analytics.test.ts && git commit -m "feat(dashboard): sales totals and trend queries"`

---

### Task 3: Top sellers and the admin entry point

**Files:**
- Modify: `src/server/services/sales-analytics.ts`
- Test: `tests/services/sales-analytics.test.ts`

**Interfaces:**
- Consumes: the private sale-lines CTE, `getSalesTotals`, `getSalesTrend` (Task 2); `Period` (Task 1).
- Produces:
  ```ts
  export type TopDimension = "parts" | "categories" | "brands" | "models";
  export type TopSort = "sales" | "profit";
  export type TopSellerRow = { key: string; name: string; detail: string | null; qty: number; netSales: string; grossProfit: string };
  export async function getTopSellers(range: DateRange, dimension: TopDimension, sort: TopSort, limit?: number): Promise<TopSellerRow[]>; // limit default 10
  export type SalesAnalytics = { current: SalesTotals; previous: SalesTotals; trend: TrendPoint[]; top: TopSellerRow[] };
  export async function getSalesAnalytics(user: SessionUser, period: Period, top: { dimension: TopDimension; sort: TopSort }): Promise<SalesAnalytics>;
  ```
- Row naming: parts → `name` = part name, `detail` = SKU, `key` = part id; categories → category name or `Uncategorised` (`key` = id or `"none"`); brands → brand name or `No brand`; models → `${make} ${model}`, via `part_fitments` inner join (parts with no fitment are left out). Group by id, order by `netSales` or `grossProfit` desc, then `name` asc.

- [ ] **Step 1: Write the failing tests**
  - `shares the invoice discount across lines`: parts A and B (Retail 1000), one invoice A×1 + B×1 with invoice discount `"200"` → parts rows A and B each `netSales "900.00"`; sum equals `getSalesTotals(range).netSales` (`"1800.00"`).
  - `subtracts returned quantities`: A×3 sold, 1 returned in range → A row `qty 2`, `netSales "2000.00"`.
  - `groups missing category and brand`: a part with no category/brand → categories row `{ name: "Uncategorised" }`, brands row `{ name: "No brand" }`; a part in category "Brakes" (insert into `categories`, pass `categoryId` to `makePart`) appears as its own row.
  - `counts a part toward every bike model it fits, and skips parts with none`: insert two `vehicleModels`; part fitting both, sold ×1 → two model rows each `"1000.00"`; a sold part with no fitment adds no row.
  - `sorts by profit`: part X (avgCost 900) sold ×2, part Y (avgCost 100) sold ×1 → by `sales`: X first; by `profit`: Y first.
  - `limits to 10`: 11 parts sold → 10 rows.
  - `refuses staff`: `getSalesAnalytics(staff, resolvePeriod({}), { dimension: "parts", sort: "sales" })` rejects with `Forbidden`.
  - `returns current, previous, trend and top for admins`: one invoice today and one dated in `period.compare` → `current.invoiceCount 1`, `previous.invoiceCount 1`, `trend.length` equals the days in range.
- [ ] **Step 2: Run to verify they fail** — `pnpm test tests/services/sales-analytics.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement `getTopSellers` and `getSalesAnalytics`** (`requireRole` first, then the four queries with `Promise.all`).
- [ ] **Step 4: Run to verify they pass** — `pnpm test tests/services/sales-analytics.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): top sellers by part, category, brand and bike model"` (plus `git add` for any new file).

---

### Task 4: Sales section — period picker, tiles, cash vs credit

**Files:**
- Create: `src/lib/sales-metrics.ts`, `tests/lib/sales-metrics.test.ts`
- Create: `src/app/(app)/dashboard/sales-section.tsx` (server), `src/app/(app)/dashboard/period-picker.tsx` (client)
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `e2e/permissions.spec.ts`

**Interfaces:**
- Consumes: `resolvePeriod`, `formatRange`, `PERIOD_PRESETS`, `Period` (Task 1); `getSalesAnalytics`, `SalesTotals`, `TopDimension`, `TopSort` (Task 3).
- Produces:
  ```ts
  // src/lib/sales-metrics.ts
  export function marginPct(netSales: string, grossProfit: string): string | null;   // "25.1"; null when netSales ≤ 0
  export function pctChange(current: string, previous: string): string | null;     // "12" / "-8"; null when previous = 0 (whole %, half-up)
  export function pointsChange(current: string | null, previous: string | null): string | null; // "-0.9"; null if either is null
  export function avgSale(invoiceSales: string, invoiceCount: number): string;      // "4120.00"; "0.00" when count is 0
  // sales-section.tsx
  export async function SalesSection(props: { user: SessionUser; params: { period?: string; from?: string; to?: string; top?: string; sort?: string } }): Promise<JSX.Element>;
  export function SalesSectionSkeleton(): JSX.Element;
  ```
  Task 5 renders its chart and table inside `SalesSection` where this task leaves the placeholder comments `{/* trend chart: Task 5 */}` and `{/* top sellers: Task 5 */}`.

- [ ] **Step 1: Write failing unit tests for `sales-metrics`**: `marginPct("1000.00", "251.00") → "25.1"`; `marginPct("0.00", "0.00") → null`; `marginPct("-500.00", "-200.00") → null`; `pctChange("1120.00", "1000.00") → "12"`; `pctChange("920.00", "1000.00") → "-8"`; `pctChange("500.00", "0.00") → null`; `pointsChange("25.1", "26.0") → "-0.9"`; `pointsChange(null, "26.0") → null`; `avgSale("9000.00", 0) → "0.00"`; `avgSale("10000.00", 3) → "3333.33"`.
- [ ] **Step 2: Run** — `pnpm test tests/lib/sales-metrics.test.ts` → FAIL; implement `src/lib/sales-metrics.ts` with `Decimal`; run → PASS.
- [ ] **Step 3: Add the staff e2e check** in `e2e/permissions.spec.ts`: `test("hides sales & profit", …)` → `page.goto("/dashboard?period=year")`, expect heading `Today` visible and heading `Sales & profit` count 0.
- [ ] **Step 4: Build the section.**
  - `page.tsx`: accept `searchParams` (Promise, like `invoices/page.tsx`); when `user.role === "admin"`, render below the tiles `<Suspense key={queryString} fallback={<SalesSectionSkeleton />}><SalesSection user={user} params={params} /></Suspense>`.
  - `SalesSection`: `resolvePeriod(params)`; `top` ∈ TopDimension else `"parts"`; `sort` ∈ TopSort else `"sales"`. Call `getSalesAnalytics` in `try/catch`; on error `console.error` and render a bordered box `Couldn't load sales figures`. Heading `<h2>Sales & profit</h2>`.
  - `PeriodPicker` (client, props `{ period: Period; today: string; keep: { top: string; sort: string } }`): preset `Link`s (`?period=…&top=…&sort=…`, active one styled with `aria-current="page"`); `Custom` button opens the existing `Popover` with a GET `<form>`: hidden `top`/`sort`, `Input type="date"` labelled `From` and `To` (`max={today}`, `To` gets `min` = current From), submit button `Apply`. When `period.preset === "custom"`, the Custom button shows `formatRange(period.range)`.
  - Tiles: reuse the existing `Tile` look (copy the `dl`/card classes from `page.tsx`, not links). `Net sales` and `Gross profit`: `Rs` value, note `▲ 12% vs Sep 1–25` / `▼ 8% …` (no "vs …" after the first tile), or `No sales before`. `Margin`: `25.1%` or `—`, note `▲/▼ 0.9 pts` or nothing. `Avg sale`: `Rs` value, note `302 invoices` (`1 invoice`). Two columns at phone width (`grid-cols-2 lg:grid-cols-4`).
  - Cash vs credit: a single bar of two `div`s sized by `cashSales / invoiceSales`, labels `Cash 68% · Rs …` and `Credit 32% · Rs …`; when `invoiceSales` is 0, text `No sales in this period`.
- [ ] **Step 5: Verify** — `pnpm typecheck && pnpm lint && pnpm test` → all PASS; `pnpm test:e2e e2e/permissions.spec.ts` → PASS. Run the app, log in as admin, check `/dashboard`, `?period=year`, `?from=…&to=…`, and `?period=foo` render; a staff login shows no section.
- [ ] **Step 6: Commit** — `git add src/lib/sales-metrics.ts tests/lib/sales-metrics.test.ts "src/app/(app)/dashboard" e2e/permissions.spec.ts && git commit -m "feat(dashboard): sales & profit tiles, period picker and cash vs credit"`

---

### Task 5: Trend chart and top sellers table

**Files:**
- Create (via CLI): `src/components/ui/chart.tsx`; `package.json`/`pnpm-lock.yaml` gain `recharts`
- Create: `src/app/(app)/dashboard/sales-trend-chart.tsx` (client), `src/app/(app)/dashboard/top-sellers.tsx` (server)
- Modify: `src/app/(app)/dashboard/sales-section.tsx`
- Test: `e2e/sales-dashboard.spec.ts`

**Interfaces:**
- Consumes: `TrendPoint`, `TopSellerRow`, `TopDimension`, `TopSort` (Tasks 2–3); `Period`, `Bucket` (Task 1); `marginPct` (Task 4).
- Produces: `SalesTrendChart({ points: TrendPoint[]; bucket: Bucket })`; `TopSellers({ rows: TopSellerRow[]; dimension: TopDimension; sort: TopSort; hrefFor: (change: { top?: TopDimension; sort?: TopSort }) => string })`.

- [ ] **Step 1: Write the failing e2e** `e2e/sales-dashboard.spec.ts` (runs after `full-flow`, which sells BRK-001 today):
  ```ts
  test.beforeEach(({ page }) => login(page, "admin"));
  test("switches periods, custom range and top-seller views", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Sales & profit" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /BRK-001/ })).toBeVisible();
    await page.getByRole("link", { name: "Last month" }).click();
    await expect(page).toHaveURL(/period=last-month/);
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await page.getByRole("button", { name: "Custom" }).click();
    await page.getByLabel("From").fill("2026-01-01"); // any date ≤ today
    await page.getByLabel("To").fill(today);           // colomboDate()
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/from=2026-01-01&to=/);
    await page.getByRole("link", { name: "Brands" }).click();
    await expect(page).toHaveURL(/top=brands/);
    await expect(page).toHaveURL(/from=2026-01-01/); // period kept
    await page.getByRole("link", { name: "Profit" }).click();
    await expect(page).toHaveURL(/sort=profit/);
  });
  ```
- [ ] **Step 2: Run to verify it fails** — `pnpm test:e2e e2e/sales-dashboard.spec.ts` → FAIL (no BRK-001 cell / no Brands link).
- [ ] **Step 3: Add the shadcn chart** — `pnpm dlx shadcn@latest add chart`; confirm it wrote `src/components/ui/chart.tsx` and added `recharts`; `pnpm typecheck` passes.
- [ ] **Step 4: Implement `SalesTrendChart`** — `ChartContainer` + Recharts `ComposedChart`: `Bar` = `netSales` (label `Net sales`), `Line` = `grossProfit` (label `Gross profit`), values converted with `Number()` for plotting only; X labels from `bucketStart` (`day`/`week`: `Oct 19`, `month`: `Oct`); `ChartTooltip` shows `Rs` + `formatMoney`; Y axis abbreviated (`120k`); negative values render below zero. Title: `Sales and profit by day|week|month`. Height ~260px; all points zero → `No sales in this period` instead of the chart.
- [ ] **Step 5: Implement `TopSellers`** — tabs as `Link`s (`Parts`, `Categories`, `Brands`, `Bike models`) and sort `Link`s (`Sales`, `Profit`) built with `hrefFor` (keeps period params); existing `Table` components; columns `#`, `Name` (+ `detail` muted, e.g. SKU), `Qty`, `Sales`, `Profit`, `Margin` (via `marginPct`, `—` when null); `Qty` and `Margin` get `hidden sm:table-cell`; empty → `No sales in this period`; on `models` add the note `A part that fits several bike models counts toward each, so these totals overlap.`
- [ ] **Step 6: Wire both into `SalesSection`** replacing Task 4's placeholders.
- [ ] **Step 7: Verify** — `pnpm test:e2e e2e/sales-dashboard.spec.ts` → PASS; `pnpm typecheck && pnpm lint` → clean.
- [ ] **Step 8: Commit** — `git add src/components/ui/chart.tsx package.json pnpm-lock.yaml "src/app/(app)/dashboard" e2e/sales-dashboard.spec.ts && git commit -m "feat(dashboard): sales trend chart and top sellers"`

---

### Task 6: Final verification

**Files:** none committed except fixes found here.

- [ ] **Step 1: Full suites** — `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` → all PASS (paste the summary lines in the report).
- [ ] **Step 2: Speed check** — a throwaway script in the session scratchpad (not in the repo), run against **local** Supabase inside a transaction that is rolled back: insert ~20,000 issued invoices with 1–4 lines each spread over 3 years plus ~500 returns (`generate_series`), then `EXPLAIN ANALYZE` the totals, trend (`month`, This year) and top-sellers (`models`) queries. Expected: each well under 300 ms and using `invoices_invoice_date_idx` / `sales_returns_return_date_idx`. Report the timings.
- [ ] **Step 3: Visual check** — admin `/dashboard` at 1280px and 390px wide, light and dark: tiles, chart, cash/credit bar, table (Qty/Margin hidden on phone), Custom popover; staff login shows only the Today part. Fix anything broken and re-run Step 1.
- [ ] **Step 4: Report and stop** — summarise to the user. Do **not** push or apply the `0007` migration to staging without asking; when they approve, apply it the way earlier migrations went to staging (see memory: staging project via MCP with a hand-written drizzle tracking row).
