# Stock Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only stock health summary at the top of the Stock page — four tiles, an age bar, ABC classes, "Most money stuck" — plus Last sold / Class columns and `age` / `class` filters on the list.

**Architecture:** Pure calculations in `src/lib/stock-health.ts`, fed by `src/server/services/stock-health.ts`, which reuses the Sales & profit sale-lines logic for 12-month sales and 90-day cost of goods. A server component renders the summary; filters live in URL params.

**Tech Stack:** Next.js 15 server components, Drizzle `sql` on Supabase Postgres, Vitest (lib + service tests on local Supabase), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-26-stock-health-design.md` — §3 defines every figure; read it first.

## Global Constraints

- Admin only (`requireRole(user, "admin")` in the service; the page renders the summary and the new columns only for admins). Staff see the Stock page unchanged and the new params are ignored for them. No database change.
- Colombo business dates (`colomboDate`, `addDays` from `@/lib/dates`); money as 2-decimal strings via `@/lib/money`; display `Rs ` + `formatMoney`.
- Age bands, keys and labels in order: `0-90` "0–90 days", `91-180` "91–180 days", `181-365` "181–365 days", `365+` "Over 365 days". Classes: `A`, `B`, `C`, `none` (label "No sales").
- Copy: tiles `Stock value`, `Slow & dead`, `Turns per year`, `Days of stock`; sub-lines `N parts in stock` (`1 part in stock`), `P% · N parts`, `last 90 days`, `at the current sales pace` / `no sales in 90 days`; sections `How long since it sold`, `Sales classes (last 12 months)`, `Most money stuck`; class rows `A · N parts · P% of sales · Rs X in stock` (+ ` · N low or out of stock` on A when > 0), `No sales · N parts · Rs X in stock`; list columns `Last sold` (`Never`), `Class` (`—` for none); filter line `Showing <label> · Show all`.
- URL params on `/stock`: existing `q`, `category`, `low`; new `age=<band key>`, `class=A|B|C|none`. Unknown values ignored. The search form keeps `age`/`class` as hidden inputs.

## Review Focus

1. **No stock and no sales at all** (fresh shop) — tiles Rs 0.00 / 0% / "—", no empty bar, no class rows except none, no stuck table, no NaN. Test in Task 1 (`summarizes an empty shop`).
2. **Parts with negative or zero sales after returns** (sold then fully returned) — "No sales", never A/B/C, and they don't break the cumulative %. Test in Task 1 (`treats zero net sales as no sales`).
3. **A part in stock with no positive movement and no sale** (data imported oddly) — counts as 0 days, band 0–90, no crash. Test in Task 1.
4. **Staff hand-typing `/stock?age=365+&class=A`** — sees the normal list, unfiltered, no summary. Test in Task 3 (e2e).
5. **Search after choosing a band** — submitting the search form keeps `age`/`class`. Test in Task 3 (e2e: fill search, submit, URL still has `age=`).

---

### Task 1: Stock health calculations

**Files:**
- Create: `src/lib/stock-health.ts`
- Test: `tests/lib/stock-health.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StockAgeBand = "0-90" | "91-180" | "181-365" | "365+";
  export type AbcClass = "A" | "B" | "C" | "none";
  export const STOCK_AGE_BANDS: { key: StockAgeBand; label: string }[];
  export const ABC_CLASSES: { key: AbcClass; label: string }[]; // A, B, C, "No sales"
  export function stockAgeBand(days: number): StockAgeBand;
  export function isStockAgeBand(v: string | undefined): v is StockAgeBand;
  export function isAbcClass(v: string | undefined): v is AbcClass;
  export function abcClasses(rows: { partId: string; sku: string; sales: string }[]): Map<string, "A" | "B" | "C">; // only parts with sales > 0
  export type StockPartInput = {
    partId: string; sku: string; name: string; qtyOnHand: number; avgCost: string;
    reorderLevel: number; isActive: boolean; lastSoldOn: string | null; firstArrivalOn: string | null;
  };
  export type PartHealth = { lastSoldOn: string | null; band: StockAgeBand | null; cls: AbcClass }; // band null when not in stock
  export type StockHealth = {
    stockValue: string; partsInStock: number;
    slowValue: string; slowPct: number; slowParts: number;
    turnsPerYear: string | null;   // one decimal, "0.5"; null when stock value is 0
    daysOfStock: number | null;    // null when no cost of goods in 90 days
    bands: { key: StockAgeBand; label: string; value: string; parts: number }[];  // all four, in order
    classes: { key: AbcClass; label: string; parts: number; salesPct: number | null; stockValue: string; lowOrOut: number }[]; // A, B, C, none; salesPct null for none
    stuck: { partId: string; sku: string; name: string; qtyOnHand: number; value: string; lastSoldOn: string | null; cls: AbcClass }[];
    byPart: Record<string, PartHealth>;
  };
  export function summarizeStock(input: { today: string; parts: StockPartInput[]; sales12: { partId: string; sales: string }[]; cogs90: string }): StockHealth;
  ```
- Rules: in stock = `qtyOnHand > 0`; value = qty × avgCost; days = `today − (lastSoldOn ?? firstArrivalOn ?? today)`. ABC: sort by sales desc then sku asc; share before part < 80% → A, < 95% → B, else C. `salesPct` and `slowPct` whole %, half-up; `lowOrOut` counts parts of that class that are active and (`qtyOnHand = 0` or (`reorderLevel > 0` and `qtyOnHand ≤ reorderLevel`)). Stuck: in-stock parts in `181-365`/`365+`, value desc then sku, max 10. Turns = cogs90 × 365 / 90 ÷ stock value, `toFixed(1)`; days of stock = stock value ÷ (cogs90 / 90), rounded.

- [ ] **Step 1: Write the failing tests** (`T = "2026-10-26"`):
  - `stockAgeBand` table: `0→"0-90"`, `90→"0-90"`, `91→"91-180"`, `180→"91-180"`, `181→"181-365"`, `365→"181-365"`, `366→"365+"`.
  - `isStockAgeBand("181-365")` true, `("abc")`/`(undefined)` false; `isAbcClass("none")` true, `("D")` false.
  - `abcClasses`: sales p1 `500`, p2 `300`, p3 `100`, p4 `60`, p5 `40` → A: p1, p2; B: p3, p4; C: p5.
  - `treats zero net sales as no sales`: `abcClasses` with p1 `100`, p2 `0.00`, p3 `-50.00` → only p1 in the map (A).
  - `summarizes a shop`: parts P1 (S1, qty 10, cost `100.00`, lastSold T−10), P2 (S2, qty 5, cost `200.00`, reorder 5, active, lastSold T−100), P3 (S3, qty 4, cost `500.00`, lastSold T−200), P4 (S4, qty 2, cost `1500.00`, never sold, firstArrival T−400), P5 (S5, qty 0, cost `100.00`, lastSold T−5); sales12 P1 `500`, P2 `300`, P5 `100`, P3 `60`; cogs90 `900.00`. Expect `stockValue "7000.00"`, `partsInStock 4`, `slowValue "5000.00"`, `slowPct 71`, `slowParts 2`, `turnsPerYear "0.5"`, `daysOfStock 700`; bands values `["1000.00","1000.00","2000.00","3000.00"]`, parts `[1,1,1,1]`; classes `A {parts 2, salesPct 83, stockValue "2000.00", lowOrOut 1}`, `B {parts 2, salesPct 17, stockValue "2000.00", lowOrOut 1}`, `C {parts 0, salesPct 0, stockValue "0.00", lowOrOut 0}`, `none {parts 1, salesPct null, stockValue "3000.00", lowOrOut 0}`; stuck SKUs `["S4","S3"]`; `byPart.P5` = `{ lastSoldOn: T−5, band: null, cls: "B" }`, `byPart.P4` = `{ lastSoldOn: null, band: "365+", cls: "none" }`.
  - `cuts the stuck list at 10`: 12 parts qty 1, cost 100…1200, never sold, firstArrival T−400 → 10 rows, first value `"1200.00"`.
  - `ages a part with no arrival and no sale as new`: one part qty 1, both dates null → band `0-90`.
  - `has no days of stock without sales`: P1 only, cogs90 `0.00` → `turnsPerYear "0.0"`, `daysOfStock null`.
  - `summarizes an empty shop`: no parts, no sales, cogs90 `0.00` → `stockValue "0.00"`, `slowPct 0`, `turnsPerYear null`, `daysOfStock null`, `stuck []`, every band `"0.00"`/0.
- [ ] **Step 2: Run** `pnpm test tests/lib/stock-health.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/stock-health.ts`** per the Interfaces block (day maths in UTC as `aging.ts` does).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/stock-health.ts tests/lib/stock-health.test.ts && git commit -m "feat(stock): stock health calculations"`

---

### Task 2: Stock health service

**Files:**
- Modify: `src/server/services/sales-analytics.ts` (add `salesByPart`)
- Create: `src/server/services/stock-health.ts`
- Test: `tests/services/stock-health.test.ts`

**Interfaces:**
- Consumes: `summarizeStock`, `StockHealth`, `StockPartInput` (Task 1); `getSalesTotals(range)` (existing).
- Produces:
  - `export async function salesByPart(range: DateRange): Promise<{ partId: string; sales: string }[]>` in `sales-analytics.ts` — Σ `net` per part from the existing private `saleLines(range)`, rounded to 2 decimals, all parts that appear.
  - `export async function getStockHealth(user: SessionUser, today?: string): Promise<StockHealth>` — `requireRole(user, "admin")`; one query for parts that are active or have stock (id, sku, name, qty, avg_cost, reorder_level, is_active, last sold = max `invoice_date` of issued invoice lines, first arrival = min Colombo date of `stock_movements.created_at` where `qty_change > 0`); `salesByPart({ from: today − 364, to: today })`; `getSalesTotals({ from: today − 89, to: today }).cost` as cogs90.

- [ ] **Step 1: Write the failing tests** (`resetDb`, `makeUser`, `makeCustomer({ creditLimit: "1000000.00" })`, `makePart({ qty, avgCost })` priced 1000.00, admin `createInvoice` credit (back-datable), `cancelInvoice`, `createReturn`, `stockList`):
  - `last sold ignores a cancelled invoice`: part sold dated `addDays(today,-30)`, another sale today then cancelled → `byPart[id].lastSoldOn` = `addDays(today,-30)`.
  - `ages a never-sold part from its arrival`: `makePart({ qty: 3 })`, then `update stock_movements set created_at = now() - interval '200 days' where part_id = …` → band `181-365`.
  - `salesByPart takes returns off`: part sold qty 3 today, return 2 → `salesByPart({from: today, to: today})` has `{ partId, sales: "1000.00" }`.
  - `days of stock follow the Sales & profit cost`: part qty 10 avgCost `600.00`, sell 1 today → `daysOfStock` = round(`stockValue` ÷ (cost ÷ 90)) with cost from `getSalesTotals` (here 5400 ÷ (600/90) = 810).
  - `stock value matches the stock list`: Σ `stockList(admin, {}).stockValue` = `stockValue`.
  - `refuses staff`: `getStockHealth(staff)` rejects with `Forbidden`.
- [ ] **Step 2: Run** `pnpm test tests/services/stock-health.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `salesByPart` and `getStockHealth`.**
- [ ] **Step 4: Run** `pnpm test tests/services/stock-health.test.ts tests/services/sales-analytics.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/server/services tests/services/stock-health.test.ts && git commit -m "feat(stock): stock health service"`

---

### Task 3: Summary and filters on the Stock page

**Files:**
- Create: `src/app/(app)/stock/stock-health.tsx` (server component)
- Modify: `src/app/(app)/stock/page.tsx`
- Test: `e2e/stock-health.spec.ts` (sorts after `full-flow`, whose sold part BRK-001 it uses)

**Interfaces:**
- Consumes: `getStockHealth` (Task 2); `STOCK_AGE_BANDS`, `ABC_CLASSES`, `isStockAgeBand`, `isAbcClass`, `StockHealth` (Task 1).
- Produces: `StockHealthSummary({ health, age, cls, hrefFor }: { health: StockHealth; age: StockAgeBand | null; cls: AbcClass | null; hrefFor: (f: { age?: StockAgeBand; cls?: AbcClass }) => string })`.

- [ ] **Step 1: Write the failing e2e** `e2e/stock-health.spec.ts`:
  ```ts
  test("admin sees stock health and filters the list", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/stock");
    for (const t of ["Stock value", "Slow & dead", "Turns per year", "Days of stock"])
      await expect(page.getByRole("term").filter({ hasText: new RegExp(`^${t}$`) })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Last sold" })).toBeVisible();
    await page.getByRole("link", { name: /^0–90 days/ }).click();
    await expect(page).toHaveURL(/age=0-90/);
    await expect(page.getByText(/Showing 0–90 days/)).toBeVisible();
    await expect(page.getByRole("link", { name: "BRK-001" })).toBeVisible();
    await page.getByLabel("Search stock").fill("BRK");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/age=0-90/);           // the band survives a search
    await page.getByRole("link", { name: /^A · / }).click();
    await expect(page).toHaveURL(/class=A/);
    await page.getByRole("link", { name: "Show all" }).click();
    await expect(page).not.toHaveURL(/age=|class=/);
  });
  test("staff see the plain stock list", async ({ page }) => {
    await login(page, "staff");
    await page.goto("/stock?age=365%2B&class=A");
    await expect(page.getByRole("term").filter({ hasText: /^Stock value$/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "BRK-001" })).toBeVisible(); // not filtered
  });
  ```
- [ ] **Step 2: Run** `pnpm test:e2e e2e/full-flow.spec.ts e2e/stock-health.spec.ts` → FAIL (no "Stock value" term).
- [ ] **Step 3: Build `StockHealthSummary`** (copy from Global Constraints): tiles in the dashboard KPI card style (`grid grid-cols-2 gap-4 lg:grid-cols-4`, `<dl>`); "How long since it sold" section with a bar of non-empty bands in `bg-aging-1…4` (2px gaps, `aria-hidden`) and one link per band (`<label> · Rs <value>`), hidden when stock value is 0; "Sales classes (last 12 months)" list with one link row per class with parts > 0; "Most money stuck" table (part link `/parts/<id>` with SKU and name, on hand, value, last sold or `Never`, class; Last sold `hidden md:table-cell`), hidden when empty. Active filter links get `aria-current="page"`.
- [ ] **Step 4: Wire the page.** For admins: read `age` / `class` (via the guards, else null), call `getStockHealth(user)` alongside `stockList`, render the summary above the search form, filter rows by `health.byPart[r.id]` (`band === age` for age, `cls === class` for class; a part missing from `byPart` counts as band null / class `none`), add `Last sold` (`hidden md:table-cell`, `formatDate` or `Never`) and `Class` columns, the "Showing <label> · Show all" line (Show all keeps `q`, `category`, `low`), and hidden `age`/`class` inputs in the search form; `hrefFor` keeps `q`, `category`, `low` and sets one of `age`/`class` (choosing one clears the other). Staff: no call, no columns, params ignored. Footer `colSpan` grows with the two columns.
- [ ] **Step 5: Verify** — `pnpm test:e2e e2e/full-flow.spec.ts e2e/stock-health.spec.ts` PASS; `pnpm typecheck && pnpm lint` clean.
- [ ] **Step 6: Commit** — `git add "src/app/(app)/stock" e2e/stock-health.spec.ts && git commit -m "feat(stock): stock health summary and filters on the Stock page"`

---

### Task 4: Final verification

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` → all pass; report the counts.
- [ ] **Step 2: Visual check** with a throwaway screenshot script saved outside the repo (not the Playwright MCP, which writes inside the repo and makes the dev server reload): sample data with parts in every band (back-date some `stock_movements.created_at` and invoices) on `/stock` in light and dark at 1280px and 390px.
- [ ] **Step 3:** Push `feature/stock-health`, open a PR into `development`; release only as the user asks.
