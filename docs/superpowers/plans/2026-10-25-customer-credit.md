# Customer Credit Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A summary at the top of Payments › Outstanding: four tiles (Owed, Overdue, Due in next 7 days, Days to collect), an aging bar that filters the invoice list, and a "Who owes" table.

**Architecture:** Pure calculations in `src/lib/aging.ts` fed by `src/server/services/credit.ts`, which reuses `outstandingInvoices()` so "owed" always matches the list. A server component renders the summary above the existing list; filters live in URL params.

**Tech Stack:** Next.js 15 server components, Drizzle `sql` on Supabase Postgres, Vitest (lib + service tests on local Supabase), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-customer-credit-design.md` — §3 defines every figure; read it first.

## Global Constraints

- Admin and staff see the page; no cost or profit anywhere in it. No database change.
- Dates are Colombo business dates (`colomboDate()`, `addDays` from `@/lib/dates`). Money as 2-decimal strings via `@/lib/money` (`D`, `fmt`, `sum`); display with `formatMoney` and an `Rs ` prefix.
- Aging groups and labels, in order: `not-due` "Not due", `1-30` "1–30 days", `31-60` "31–60 days", `61-90` "61–90 days", `90+` "Over 90 days".
- Copy, exactly: tiles `Owed`, `Overdue`, `Due in next 7 days`, `Days to collect`; sub-lines `N customers` / `N customer`, `P% · N customers`, `N invoices` / `N invoice`, `last 90 days`; DSO without credit sales `—` with `no credit sales in 90 days`; note `Rs X paid in advance, not yet matched to invoices`; section `How late`; table heading `Who owes` with sort links `Most owed` / `Most overdue`; columns `Customer`, `Owed`, `Overdue`, `Oldest late`, `Credit limit used`, `Last paid`; `Over limit`, `No limit set`, `Never`; filter line `Showing <label> · Show all`.
- URL params on `/payments?view=outstanding`: `overdue=1` (existing), `late=<group key>`, `by=owed|overdue`. Unknown values are ignored.

## Review Focus

1. **A shop with nothing owed** — tiles show Rs 0.00, `0%`, DSO `—` or 0 without NaN, no empty bar or empty table; the list keeps "Every invoice is paid." Test in Task 1 (`summarizes an empty book`).
2. **Hand-edited `late`/`by`** (`late=abc`, `by=xyz`) — ignored, page renders all unpaid sorted by owed. Test in Task 3 (e2e visits `?view=outstanding&late=abc&by=xyz`).
3. **A customer whose payments exceed what they ever owed** (prepaid, nothing open) — not in "Who owes", but counted in the advance-payment note. Test in Task 2.
4. **An invoice due exactly today** — Not due, and counted in "Due in next 7 days", not overdue. Test in Task 1.
5. **`overdue=1` and `late` together** — `late` wins (one group), the "Overdue only" button is not shown as active. Test in Task 3 (e2e).

---

### Task 1: Aging calculations

**Files:**
- Create: `src/lib/aging.ts`
- Test: `tests/lib/aging.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AgingGroupKey = "not-due" | "1-30" | "31-60" | "61-90" | "90+";
  export const AGING_GROUPS: { key: AgingGroupKey; label: string }[]; // order and labels from Global Constraints
  export function agingGroup(dueDate: string, today: string): AgingGroupKey;
  export function isAgingGroupKey(v: string | undefined): v is AgingGroupKey;
  export type OpenInvoice = { invoiceId: string; customerId: string; customerName: string; dueDate: string; outstanding: string };
  export type CustomerFacts = { customerId: string; name: string; creditLimit: string; balance: string; lastPaidOn: string | null };
  export type CustomerCreditRow = {
    customerId: string; name: string; owed: string; overdue: string;
    oldestDaysLate: number;            // 0 when nothing is overdue
    limitUsedPct: number | null;       // null when credit limit is 0
    overLimit: boolean; lastPaidOn: string | null;
  };
  export type CreditSummary = {
    owed: string; customersOwing: number;
    overdue: string; overduePct: number; customersOverdue: number;
    dueSoon: string; dueSoonInvoices: number;
    dso: number | null;                // null when there were no credit sales in 90 days
    unappliedCredit: string;
    groups: { key: AgingGroupKey; label: string; amount: string; invoices: number }[]; // all five, in order
    customers: CustomerCreditRow[];
  };
  export function summarizeCredit(
    input: { today: string; open: OpenInvoice[]; customers: CustomerFacts[]; creditSales90: string },
    by?: "owed" | "overdue", // default "owed"
  ): CreditSummary;
  ```
- Rules: percentages are whole numbers, half-up (`Decimal.toFixed(0)`). `limitUsedPct` = owed ÷ creditLimit × 100; `overLimit` = owed > creditLimit (only when creditLimit > 0). `dso` = owed ÷ creditSales90 × 90 rounded. `unappliedCredit` = Σ over **all** `customers` of max(0, owed_c − balance_c) where owed_c is that customer's open total (0 if none). `customers` rows only for customers with an open invoice; names come from `OpenInvoice.customerName`. Sort `owed`: owed desc, name asc; `overdue`: overdue desc, oldestDaysLate desc, name asc.

- [ ] **Step 1: Write the failing tests** (`T = "2026-10-25"`)
  - `agingGroup` table: `["2026-10-26","not-due"]`, `["2026-10-25","not-due"]`, `["2026-10-24","1-30"]`, `["2026-09-25","1-30"]`, `["2026-09-24","31-60"]`, `["2026-08-26","31-60"]`, `["2026-08-25","61-90"]`, `["2026-07-27","61-90"]`, `["2026-07-26","90+"]`.
  - `isAgingGroupKey("31-60")` true; `isAgingGroupKey("abc")` and `isAgingGroupKey(undefined)` false.
  - `summarizes a book` with: customers A (limit `10000.00`, balance `9000.00`, lastPaidOn `2026-10-20`), B (limit `0.00`, balance `4500.00`, lastPaidOn `null`), C (limit `0.00`, balance `-500.00`, no open invoices); open invoices a1 A due `addDays(T,-40)` `3000.00`, a2 A due `addDays(T,3)` `6000.00`, b1 B due `addDays(T,-5)` `3500.00`, b2 B due `addDays(T,10)` `1000.00`, b3 B due `addDays(T,-100)` `500.00`; `creditSales90 "25000.00"`. Expect:
    `owed "14000.00"`, `customersOwing 2`, `overdue "7000.00"`, `overduePct 50`, `customersOverdue 2`, `dueSoon "6000.00"`, `dueSoonInvoices 1`, `dso 50`, `unappliedCredit "1000.00"`;
    groups amounts `["7000.00","3500.00","3000.00","0.00","500.00"]`, invoices `[2,1,1,0,1]`;
    customers (by owed) `[{name A, owed "9000.00", overdue "3000.00", oldestDaysLate 40, limitUsedPct 90, overLimit false, lastPaidOn "2026-10-20"}, {name B, owed "5000.00", overdue "4000.00", oldestDaysLate 100, limitUsedPct null, overLimit false, lastPaidOn null}]`.
  - `sorts by overdue`: same input with `by "overdue"` → `["B","A"]`.
  - `counts due today and today+6 as due soon, not today+7`: three `100.00` invoices due T, T+6, T+7 → `dueSoon "200.00"`, `dueSoonInvoices 2`, `overdue "0.00"`.
  - `flags over limit`: A limit `8000.00` owing `9000.00` → `limitUsedPct 113`, `overLimit true`.
  - `has no DSO without credit sales`: `creditSales90 "0.00"` → `dso null`.
  - `summarizes an empty book`: no open, no customers, `creditSales90 "0.00"` → `owed "0.00"`, `overduePct 0`, `customersOwing 0`, `dso null`, every group `"0.00"`/0, `customers []`.
- [ ] **Step 2: Run** `pnpm test tests/lib/aging.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/aging.ts`** per the Interfaces block (days late = whole days between `dueDate` and `today` in UTC date maths, as `periods.ts` does).
- [ ] **Step 4: Run** `pnpm test tests/lib/aging.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/aging.ts tests/lib/aging.test.ts && git commit -m "feat(credit): aging groups and credit summary calculations"`

---

### Task 2: Credit summary service

**Files:**
- Create: `src/server/services/credit.ts`
- Test: `tests/services/credit.test.ts`

**Interfaces:**
- Consumes: `summarizeCredit`, `CreditSummary`, `OpenInvoice`, `CustomerFacts` (Task 1); `outstandingInvoices()` from `src/server/services/customers.ts` (returns `OutstandingRow[]` with `invoiceId, customerId, customerName, dueDate, outstanding`).
- Produces: `export async function getCreditSummary(by?: "owed" | "overdue", today?: string): Promise<CreditSummary>` (today defaults to `colomboDate()`).
- Queries (Drizzle `sql`, like `customerBalance`): customer facts for every customer that has an open invoice **or** a non-zero balance — `credit_limit::text`, balance = Σ issued invoice totals − Σ active payments (refunds are negative, so they add back) − Σ return totals, `max(payment_date)` over active, non-refund payments; and `creditSales90` = Σ `total` of issued `payment_type = 'credit'` invoices with `invoice_date` between `today − 89` and `today`.

- [ ] **Step 1: Write the failing tests** (`resetDb`, `makeUser("admin")`, `makeCustomer({ creditLimit: "100000.00" })` (creditDays 30), `makePart({ qty: 50, avgCost: "600.00" })` priced 1000.00, `createInvoice` credit, `receivePayment`, `createReturn`, `cancelInvoice`):
  - `matches the outstanding list and ages it`: X: credit invoice qty 2 dated `addDays(today,-40)` (due today−10), return 1 of it → owed 1000; Y: credit invoice qty 2 today, cash payment `500` → owed 1500, lastPaidOn today; a cancelled credit invoice for Y. Expect `owed` = fmt(sum of `outstandingInvoices()` outstanding) = `"2500.00"`; groups `1-30` = `"1000.00"`, `not-due` = `"1500.00"`; X row `{ overdue "1000.00", oldestDaysLate 10, lastPaidOn null }`; Y row `{ overdue "0.00", lastPaidOn today }`.
  - `counts prepaid money for a customer with nothing open`: Z: credit invoice qty 1 today, payment `1500` → Z not in `customers`, `unappliedCredit "500.00"`.
  - `computes DSO from 90 days of credit sales`: only Y's invoice (2000.00 credit, today) and owed 1500 → `dso 68` (1500/2000×90 = 67.5 → 68); a credit invoice dated `addDays(today,-90)` for a **separate** customer W, fully paid, is outside the window: `dso` stays 68 (a separate customer, because payments settle the oldest invoice first).
- [ ] **Step 2: Run** `pnpm test tests/services/credit.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `getCreditSummary`.**
- [ ] **Step 4: Run** `pnpm test tests/services/credit.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/server/services/credit.ts tests/services/credit.test.ts && git commit -m "feat(credit): credit summary service"`

---

### Task 3: Summary on Payments › Outstanding

**Files:**
- Create: `src/app/(app)/payments/credit-summary.tsx` (server component)
- Modify: `src/app/(app)/payments/page.tsx` (`SearchParams` gains `late`, `by`; `Outstanding` gets `late`, renders the summary first)
- Modify: `src/app/globals.css` (aging colours `--aging-1`…`--aging-4` in `:root` and `.dark`, mapped as `--color-aging-1…4` in the `@theme` block)
- Test: `e2e/outstanding-credit.spec.ts` (name sorts after `full-flow`, whose data it uses), `tests/lib/theme-contrast.test.ts` (aging colours)

**Interfaces:**
- Consumes: `getCreditSummary` (Task 2); `AGING_GROUPS`, `agingGroup`, `isAgingGroupKey`, `CreditSummary` (Task 1).
- Produces: `CreditSummary({ summary, late, by }: { summary: CreditSummary; late: AgingGroupKey | null; by: "owed" | "overdue" })`.

- [ ] **Step 1: Write the failing e2e** `e2e/outstanding-credit.spec.ts` (after full-flow: Nimal Perera owes on a credit invoice dated today, so it is Not due):
  ```ts
  test("staff sees who owes and filters the list by how late", async ({ page }) => {
    await login(page, "staff");
    await page.goto("/payments?view=outstanding&late=abc&by=xyz"); // bad params are ignored
    for (const t of ["Owed", "Overdue", "Due in next 7 days", "Days to collect"]) await expect(page.getByText(t, { exact: true })).toBeVisible();
    const who = page.getByRole("region", { name: "Who owes" });
    await expect(who.getByRole("link", { name: "Nimal Perera" })).toBeVisible();
    await page.getByRole("link", { name: /^Not due/ }).click();
    await expect(page).toHaveURL(/late=not-due/);
    await expect(page.getByText(/Showing Not due/)).toBeVisible();
    await page.goto("/payments?view=outstanding&overdue=1&late=not-due");
    await expect(page.getByRole("link", { name: "Overdue only" })).not.toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Show all" }).click();
    await expect(page).not.toHaveURL(/late=/);
  });
  ```
  And in `tests/lib/theme-contrast.test.ts`: `aging colours stand out on the card` — for `aging-1`…`aging-4` in both `:root` (card `#ffffff`) and `.dark` (card from tokens): hex, contrast ≥ 2:1 (ordinal marks with text labels).
- [ ] **Step 2: Run** `pnpm test tests/lib/theme-contrast.test.ts` → FAIL (no aging tokens); `pnpm test:e2e e2e/full-flow.spec.ts e2e/outstanding-credit.spec.ts` → FAIL (no "Days to collect").
- [ ] **Step 3: Aging colours.** One blue ramp from the dataviz reference palette, later = stronger: light `--aging-1..4` = `#86b6ef`, `#5598e7`, `#2a78d6`, `#1c5cab`; dark = `#184f95`, `#256abf`, `#3987e5`, `#6da7ec`. Validate with `node <dataviz skill>/scripts/validate_palette.js "<4 hexes>" --mode light --surface "#ffffff" --ordinal` and `--mode dark --surface "#16252a" --ordinal`; if a check fails, move that step one ramp step and re-run. Not due uses `bg-muted-foreground/40`.
- [ ] **Step 4: Build `CreditSummary`.**
  - Tiles: same card classes as the dashboard KPI tiles (`grid grid-cols-2 gap-4 lg:grid-cols-4`), copy from Global Constraints; advance-payment note under the tiles when `unappliedCredit` > 0.
  - "How late" (`<section aria-labelledby>` titled `How late`): a bar of non-empty groups (widths by amount, `gap-0.5`), then one `Link` per group, labelled `<label> · Rs <amount>`, to `/payments?view=outstanding&late=<key>` (+`by` when not `owed`), `aria-current="page"` on the active group. Nothing owed → the section is not rendered.
  - "Who owes" (`<section aria-labelledby>` titled `Who owes`): sort links `Most owed` / `Most overdue` (keep `late`), the existing `Table` components; customer name links to `/customers/<id>`; Overdue `—` when 0; Oldest late `N days` or `—`; Credit limit used: a 48px bar (capped at 100%) + `N%`, `Over limit` as a destructive `Badge`, or `No limit set`; Last paid `formatDate` or `Never`; `Oldest late` and `Last paid` columns `hidden md:table-cell`. No rows → section not rendered.
- [ ] **Step 5: Wire the page.** `PaymentsPage` reads `late` (via `isAgingGroupKey`, else `null`) and `by` (`overdue` else `owed`); `Outstanding({ overdueOnly, late, by })` calls `getCreditSummary(by)` and `outstandingInvoices({ overdueOnly: overdueOnly && !late })` in parallel, filters rows with `agingGroup(r.dueDate, colomboDate()) === late` when `late` is set, renders `<CreditSummary>` above the existing buttons; with `late` set the "Overdue only" button is not active and a line `Showing <label> · ` + `Show all` link (`/payments?view=outstanding`, keeping `by`) appears above the table; footer label `Total owed`/`Total overdue` unchanged, `Total in group` when `late` is set.
- [ ] **Step 6: Verify** — `pnpm test tests/lib/theme-contrast.test.ts` PASS; `pnpm test:e2e e2e/full-flow.spec.ts e2e/outstanding-credit.spec.ts` PASS; `pnpm typecheck && pnpm lint` clean.
- [ ] **Step 7: Commit** — `git add "src/app/(app)/payments" src/app/globals.css e2e/outstanding-credit.spec.ts tests/lib/theme-contrast.test.ts && git commit -m "feat(credit): who owes and how late, on Payments › Outstanding"`

---

### Task 4: Final verification and PR

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` → all pass; report the counts.
- [ ] **Step 2: Visual check** with a throwaway screenshot script saved outside the repo (the Playwright MCP writes inside the repo and makes the dev server reload): sample data with overdue invoices in several groups (back-dated credit invoices), `/payments?view=outstanding` in light and dark at 1280px and 390px; check the bar, the group links, the table on phone (Oldest late and Last paid hidden), the advance-payment note.
- [ ] **Step 3:** Push `feature/customer-credit` and open a PR into `development`; do not merge unless asked.
