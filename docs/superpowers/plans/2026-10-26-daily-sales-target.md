# Daily Sales Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins set a daily net-sales target in Settings, see today's and the month's progress against it on the dashboard, and download a daily report PDF.

**Architecture:** Two new tables keep the target history and closed dates. A pure module (`src/lib/sales-target.ts`) turns target rows, closed dates and per-day net sales into a month plan; one service builds the report from the existing `getSalesTotals` / `getSalesTrend`; the dashboard card and the PDF both render that report.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Drizzle ORM on Postgres (local Supabase for tests), Zod, Vitest, Playwright, `@react-pdf/renderer`, `@/lib/money` (decimal strings).

**Spec:** `docs/superpowers/specs/2026-10-26-daily-sales-target-design.md`

## Global Constraints

- Admins only, everywhere: services call `requireRole(user, "admin")`; the report route returns `403 "Admins only"` to staff; staff never receive target data.
- Dates are Colombo business dates (`colomboDate()`, `addDays()` from `@/lib/dates`). Weekdays are ISO: 1 = Monday … 7 = Sunday.
- Sales = **net sales** (`getSalesTotals(...).netSales`): excluding VAT, after returns, cancelled invoices ignored. Money collected = active `payments` on the day, refunds included (negative), VAT included.
- Money is 2-decimal strings; maths via `D`, `fmt`, `sum` from `@/lib/money`; display `Rs ` + `formatMoney`.
- Daily target: > 0 and ≤ 99,999,999.99. Closed weekdays: unique values 1–7, at most 6. Closed-date reason ≤ 100 characters.
- Copy: card title `Daily target`; statuses `Hit`, `Missed`, `In progress`, `Closed`, `No target`; `Rs X over` / `Rs X to go` / `Rs X short`; `Month target reached`; `Missed the month by Rs X`; `No daily target yet` + link `Set a daily target`; `Couldn't load the sales target`; errors `Closed dates can't be in the past`, `<d MMM yyyy> is already closed`, `Past closed dates can't be removed`, `That date isn't closed`, `Choose a date up to today`, `Admins only`; PDF title `Daily sales report`; PDF foot `Net sales exclude VAT and are after returns. Money collected includes VAT.`
- Migration `0010_sales_targets` goes to the Supabase project (`iuwjtvyyghefjkbiqiiq`, serves preview and production) via MCP + a hand-written drizzle tracking row, **before** the code is merged and only after the user says go (Task 8).

## Review Focus

1. **The target changed mid-month** — days before the change keep the old target and status; month target mixes both. Test in Task 3 (`a later target leaves earlier days unchanged`).
2. **Today is the last trading day and still in progress** — the month is not reported `missed` yet and need-per-day is null. Test in Task 2 (`does not miss the month while the last day is in progress`).
3. **A return today for an older invoice makes today's net sales negative** — status `Missed`/`In progress`, bars clamp to 0 %, no crash. Test in Task 2 (`percentOf clamps negative sales to 0`).
4. **The first target is set today, mid-month** — earlier days are `no-target`, the month target counts only today onward, days hit is out of today only. Test in Task 2 (`counts only days from the first target`).
5. **A report for a date in an earlier month** — the plan is for that month; trading days left are counted after the report date within that month, not from today. Test in Task 3 (`reports an earlier month as of its date`).

---

### Task 1: Schema and migration

**Files:**
- Create: `src/server/db/schema/targets.ts` (new file — `columns.ts` imports `reference.ts`, so `audit()` can't be used inside `reference.ts`)
- Modify: `src/server/db/schema/index.ts` (`export * from "./targets";`)
- Create: `drizzle/0010_sales_targets.sql`, `drizzle/meta/0010_snapshot.json`, journal entry (from `pnpm db:generate`)
- Test: `tests/services/schema.test.ts`

**Interfaces:**
- Produces (from `@/server/db/schema`):
  - `salesTargets` → table `sales_targets`: `id` uuid pk defaultRandom; `effectiveFrom` date(string) not null **unique**; `dailyTarget` `money()` not null; `closedWeekdays` `smallint().array()` not null default `[]`; `...audit()`. Checks `sales_targets_positive` (`daily_target > 0`), `sales_targets_weekdays` (`closed_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(closed_weekdays) < 7`).
  - `closedDays` → table `closed_days`: `day` date(string) pk; `reason` text null; `...audit()`.

- [ ] **Step 1: Write the failing schema tests** (new `describe("sales targets")`, rows inserted directly with a `makeUser("admin")` id as `createdBy`):
  - `rejects a zero target` → `pgErrorCode(...)` is `"23514"`.
  - `rejects all seven weekdays closed` → `"23514"`.
  - `rejects weekday 8` → `"23514"`.
  - `allows one target per day` → a second row with the same `effectiveFrom` gives `"23505"`.
  - `allows one closed row per date` → `"23505"`.
- [ ] **Step 2: Run** `pnpm test tests/services/schema.test.ts` — Expected: FAIL (no `salesTargets` export).
- [ ] **Step 3: Add `targets.ts`** with both tables, a doc comment on each ("Daily sales target history: each row applies from `effective_from` until the next row." / "Dates the shop is shut beyond its closed weekdays, e.g. Poya days."), and export it from `index.ts`.
- [ ] **Step 4: Generate** `pnpm db:generate --name sales_targets`. Check `drizzle/0010_sales_targets.sql` has both tables, the unique constraint and both checks. Append by hand, matching `0009`:
  ```sql
  --> statement-breakpoint
  -- RLS on with no policies, like every other app table (see 0001): the browser roles never read it.
  ALTER TABLE "sales_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
  ALTER TABLE "closed_days" ENABLE ROW LEVEL SECURITY;
  ```
- [ ] **Step 5: Run** `pnpm test tests/services/schema.test.ts` — Expected: PASS. `pnpm typecheck` — Expected: clean. (`resetDb` truncates every schema table automatically.)
- [ ] **Step 6: Commit**
  ```bash
  git add src/server/db/schema drizzle tests/services/schema.test.ts
  git commit -m "feat(targets): sales target and closed day tables"
  ```

---

### Task 2: Month plan (pure functions)

**Files:**
- Create: `src/lib/sales-target.ts`
- Modify: `src/lib/periods.ts` (export the existing `isDate`)
- Test: `tests/lib/sales-target.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TargetRow = { effectiveFrom: string; dailyTarget: string; closedWeekdays: number[] };
  export type DayStatus = "hit" | "missed" | "in-progress" | "upcoming" | "closed" | "no-target";
  export type PlanDay = { date: string; target: string | null; sales: string; status: DayStatus };
  export type MonthPlan = {
    days: PlanDay[];              // every day of the report date's calendar month, 1st → last
    monthTarget: string;          // Σ targets of all trading days in the month
    paceTarget: string;           // Σ targets of trading days ≤ reportDate
    mtd: string;                  // Σ sales 1st → reportDate
    daysHit: number;
    daysCounted: number;          // N in "H of N" (spec §2)
    tradingDaysLeft: number;      // trading days after reportDate in the month
    needPerDay: string | null;    // (monthTarget − mtd) ÷ tradingDaysLeft, only when outcome is "open" and tradingDaysLeft > 0
    outcome: "open" | "reached" | "missed";
    hasTarget: boolean;           // any trading day in the month
  };
  export function isoWeekday(date: string): number;
  export function targetOn(date: string, rows: TargetRow[]): TargetRow | null;
  export function isTradingDay(date: string, rows: TargetRow[], closedDays: ReadonlySet<string>): boolean;
  export function monthPlan(input: {
    reportDate: string; today: string; rows: TargetRow[]; closedDays: string[];
    dailySales: Record<string, string>; // missing dates = "0.00"
  }): MonthPlan;
  export function percentOf(value: string, of: string): number; // whole %, clamped at 0; 0 when `of` ≤ 0
  export function parseReportDate(value: string | null | undefined, today: string): string | null; // missing → today; invalid or > today → null
  ```
- Status rules (spec §2): not trading → `no-target` when no row in force, else `closed`; date > reportDate → `upcoming`; sales ≥ target → `hit`; date === reportDate === today → `in-progress`; else `missed`. `outcome`: `reached` when hasTarget and mtd ≥ monthTarget; `missed` when tradingDaysLeft = 0 and the report date's status isn't `in-progress`; else `open`.

- [ ] **Step 1: Write the failing tests** `tests/lib/sales-target.test.ts` (rows `R = { effectiveFrom: "2026-10-01", dailyTarget: "250000.00", closedWeekdays: [7] }`; October 2026 starts on a Thursday, has 4 Sundays → 27 trading days):
  - `isoWeekday`: `"2026-10-26"` → 1, `"2026-10-25"` → 7.
  - `targetOn uses the latest row on or before the date`: rows effective `10-01` (250000) and `10-15` (300000) → `10-14` gives 250000, `10-15` gives 300000, `09-30` gives `null`.
  - `isTradingDay` false on Sunday `10-25` and on a closed date `10-02`; true on `10-26`.
  - `month target over trading days`: `monthPlan` with `R`, report `10-26`, today `10-26` → `monthTarget` `"6750000.00"`, `days.length` 31.
  - `mixes targets across a mid-month change`: rows 10-01 250000 and 10-15 300000, no closed weekdays → `monthTarget` = 14 × 250000 + 17 × 300000 = `"8600000.00"`.
  - `marks hit, missed, in-progress, upcoming and closed`: sales `{ "10-01": "260000", "10-02": "100000", "10-26": "50000" }`, report = today = `10-26` → `10-01` hit, `10-02` missed, `10-04` closed, `10-26` in-progress, `10-27` upcoming.
  - `counts today once it is hit`: same with `10-26` = `"250000"` → status hit, and `daysCounted` includes it; with `"50000"` it doesn't.
  - `need per day`: R, report = today = `10-26`, sales summing to `"3000000.00"` by `10-26` → `tradingDaysLeft` 5 (27–31 Oct, no Sunday), `needPerDay` `"750000.00"`.
  - `reports the month reached` when mtd ≥ monthTarget → `outcome` `"reached"`, `needPerDay` `null`.
  - `does not miss the month while the last day is in progress`: report = today = `10-31` (a Saturday, trading), short of target → `outcome` `"open"`, `needPerDay` `null`; same with today `11-01` (report in the past) → `"missed"`.
  - `counts only days from the first target`: single row effective `10-20` → `10-19` is `no-target`, `monthTarget` `"2750000.00"` (11 trading days 20–31 Oct), `daysCounted` excludes 1–19.
  - `has no target when no row is in force`: rows `[]` → `hasTarget` false, `monthTarget` `"0.00"`, every day `no-target`.
  - `percentOf clamps negative sales to 0`: `percentOf("-500.00", "250000.00")` → 0; `percentOf("125000.00", "250000.00")` → 50; `percentOf("1.00", "0.00")` → 0.
  - `parseReportDate`: `null` → today; `"2026-02-30"` → null; tomorrow → null; `"2026-10-01"` → itself.
  - Month lengths: February 2027 plan has 28 days, February 2028 has 29.
- [ ] **Step 2: Run** `pnpm test tests/lib/sales-target.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/sales-target.ts`. Pure: no database, no `colomboDate()` calls (dates come in). Use `addDays` from `@/lib/dates` to walk the month.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/sales-target.ts src/lib/periods.ts tests/lib/sales-target.test.ts
  git commit -m "feat(targets): month plan from targets, closed days and daily sales"
  ```

---

### Task 3: Target service — settings, closed days, report

**Files:**
- Create: `src/server/services/sales-targets.ts`
- Test: `tests/services/sales-targets.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; Task 2 `TargetRow`, `DayStatus`, `MonthPlan`, `monthPlan`, `targetOn`; `getSalesTotals`, `getSalesTrend` from `@/server/services/sales-analytics`; `resolvePeriod` from `@/lib/periods` (`{ period: "month" }` at the report date gives the last-month comparison range); `getSettings`.
- Produces:
  ```ts
  export const salesTargetInputSchema: z.ZodType; // { dailyTarget: string (money, > 0, ≤ 99,999,999.99), closedWeekdays: number[] (unique ints 1–7, ≤ 6) }
  export type SalesTargetInput = z.input<typeof salesTargetInputSchema>;
  export const closedDayInputSchema: z.ZodType;   // { day: YYYY-MM-DD, reason?: string ≤ 100 (optionalText) }
  export type ClosedDayInput = z.input<typeof closedDayInputSchema>;
  export type TargetSettings = {
    current: (TargetRow & { createdAt: Date }) | null;
    previous: TargetRow | null;
    closedDays: { day: string; reason: string | null }[]; // today onward, ascending
  };
  export async function getTargetSettings(user: SessionUser): Promise<TargetSettings>;
  export async function saveSalesTarget(user: SessionUser, input: SalesTargetInput): Promise<void>; // upsert on effective_from = today
  export async function addClosedDay(user: SessionUser, input: ClosedDayInput): Promise<void>;
  export async function removeClosedDay(user: SessionUser, day: string): Promise<void>;
  export type DailyTargetReport = {
    date: string;
    today: string;
    business: { name: string; address: string; phone: string };
    day: {
      netSales: string; target: string | null; status: DayStatus;
      invoiceCount: number; avgSale: string; cashSales: string; creditSales: string;
      collected: string; lastWeekSales: string;
    };
    month: MonthPlan & { lastMonthMtd: string };
  };
  export async function getDailyTargetReport(user: SessionUser, date: string): Promise<DailyTargetReport>;
  ```
- Errors: past `day` → `InvalidState("Closed dates can't be in the past")`; existing → `InvalidState("<formatDate(day)> is already closed")`; removing a past day → `InvalidState("Past closed dates can't be removed")`; missing → `NotFound("That date isn't closed")`. `getDailyTargetReport` with `date > today` → `InvalidState("Choose a date up to today")`.
- `avgSale` = `invoiceSales ÷ invoiceCount` (`"0.00"` when 0). `collected` = one `sum(amount)` over `payments` with `payment_date = date and status = 'active'`. Month sales come from `getSalesTrend({ from: 1st, to: date }, "day")`.

- [ ] **Step 1: Write the failing tests** `tests/services/sales-targets.test.ts` (`resetDb` per test; `admin`, `staff` via `makeUser`; sell with `createInvoice(admin, …)` — admins may back-date with `invoiceDate`; `makePart({ qty: 50 })` is Retail 1000.00):
  - `refuses staff` — each of the five functions rejects with `Forbidden`.
  - `saving twice on one day keeps one row` — save 250000 then 300000 → one row, `current.dailyTarget` `"300000.00"`.
  - `a later target leaves earlier days unchanged` — insert a row effective 10 days ago (250000) directly, then `saveSalesTarget` 300000 today; sell Rs 260,000 dated 3 days ago → that day `hit` with target `"250000.00"`.
  - `rejects a zero target and seven closed weekdays` — `ZodError` both.
  - `closed date rules` — yesterday → "Closed dates can't be in the past"; a date twice → "… is already closed"; remove a past row (inserted directly) → "Past closed dates can't be removed"; remove an unknown date → `NotFound`; add then remove tomorrow → `getTargetSettings().closedDays` empty.
  - `day figures` — VAT on at 18 %; today a cash sale of 2 × 1000, a credit sale of 1 × 1000, a cancelled 1 × 1000, a return (`createReturn`) of the credit sale's line, and a credit payment (`receivePayment`) of 500 → `netSales` `"2000.00"`, `invoiceCount` 2, `avgSale` `"1500.00"`, `cashSales` `"2000.00"`, `creditSales` `"1000.00"`, `collected` `"2860.00"` (cash invoice 2360.00 incl. VAT + 500; a credit-invoice return refunds nothing).
  - `compares with last week` — a sale dated 7 days ago → `lastWeekSales` equals its net.
  - `reports an earlier month as of its date` — target row (no closed weekdays) effective 90 days ago, no sales; report for the 10th of last month → `month.days[0].date` is last month's 1st, `tradingDaysLeft` = that month's length − 10, `day.status` `"missed"`, `outcome` `"open"`.
  - `rejects a future date` — tomorrow → `InvalidState`.
- [ ] **Step 2: Run** `pnpm test tests/services/sales-targets.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the service. Run the report's queries in parallel (`Promise.all`): settings, target rows (all rows with `effective_from ≤ month end`), closed days in the month, day totals, last-week totals, last-month MTD totals, trend, collected.
- [ ] **Step 4: Run** the tests, then `pnpm test tests/services` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/server/services/sales-targets.ts tests/services/sales-targets.test.ts
  git commit -m "feat(targets): target settings, closed days and the daily report service"
  ```

---

### Task 4: Settings — Sales target section

**Files:**
- Create: `src/server/actions/sales-targets.ts`, `src/app/(app)/settings/sales-target-form.tsx`, `src/app/(app)/settings/closed-days.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: Task 3 functions and types.
- Produces: `saveSalesTargetAction(input: SalesTargetInput)`, `addClosedDayAction(input: ClosedDayInput)`, `removeClosedDayAction(day: string)` — each `runAction(...)`, `requireUser()`, then `revalidatePath("/dashboard")` and `revalidatePath("/settings")`.

- [ ] **Step 1: Actions**, shaped like `src/server/actions/settings.ts`.
- [ ] **Step 2: `SalesTargetForm`** (client): heading `Sales target`; `Daily target (Rs)` money input; `Closed weekdays` — seven checkboxes labelled `Monday` … `Sunday` (values 1–7); `Save target` button; toast `Sales target saved`; field error under the input. Below: `In force since <formatDate(current.effectiveFrom)>` and, when `previous`, `Before: Rs <amount>, closed <weekday names or "none">`. With no `current`: `No daily target yet.`
- [ ] **Step 3: `ClosedDays`** (client): heading `Closed dates`; list of `closedDays` (`formatDate(day)` · reason · `Remove` button with `aria-label="Remove <date>"`); add form: date input (`min` = today, label `Date`), `Reason` input (`maxLength 100`, placeholder `e.g. Vesak Poya`), `Add closed date`. Errors shown under the form.
- [ ] **Step 4: Page**: load `getTargetSettings(user)` alongside settings and render both components below `SettingsForm`, in a section with `id="sales-target"` (the dashboard links to `/settings#sales-target`).
- [ ] **Step 5: Check** `pnpm lint`, `pnpm typecheck` — Expected: clean. Browser check with the `run` skill: save a target, save again, add and remove a closed date.
- [ ] **Step 6: Commit**
  ```bash
  git add src/server/actions/sales-targets.ts "src/app/(app)/settings"
  git commit -m "feat(targets): sales target and closed dates in Settings"
  ```

---

### Task 5: Dashboard card

**Files:**
- Create: `src/app/(app)/dashboard/target-section.tsx` (server), `src/app/(app)/dashboard/report-picker.tsx` (client)
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getDailyTargetReport(user, colomboDate())`, `percentOf`, `MonthPlan`.
- Produces: `TargetSection({ user }: { user: SessionUser })`, `TargetSectionSkeleton()`.

- [ ] **Step 1: `TargetSection`**, following `sales-section.tsx`: try/catch around the service → on error `console.error` and a `role="alert"` box `Couldn't load the sales target`. Layout per spec §3:
  - Title `Daily target` with a muted `net sales, excl. VAT`; the report picker on the right.
  - No target (`!month.hasTarget`): `No daily target yet` + link `Set a daily target` → `/settings#sales-target`.
  - Today row: `Rs <netSales> of Rs <target>`, a bar (`role="progressbar"`, `aria-valuenow` = `percentOf`, width clamped to 100 %), `<n>%`, then `Hit · Rs X over` / `In progress · Rs X to go`, or `Closed today` when today isn't a trading day.
  - Month row: `Rs <mtd> of Rs <monthTarget> · <n> trading days`, bar with a pace mark at `percentOf(paceTarget, monthTarget)`; then `<daysHit> of <daysCounted> days hit ·` and `Need Rs X a day for the <tradingDaysLeft> trading days left` / `Month target reached` / `Missed the month by Rs X`.
  - Day squares: one per `month.days` entry; colours via existing tokens — hit `bg-success`, missed `bg-destructive`, closed/no-target `bg-muted`, upcoming `border`, today `ring-2 ring-ring`; each `<span>` has `title` and `aria-label` `Thu 3 Oct: Rs 260,000 of Rs 250,000 — hit` (closed: `— closed`). A one-line legend. Squares wrap.
- [ ] **Step 2: `ReportPicker`** (client): `<input type="date" aria-label="Report date" max={today}>` defaulting to today, and a `Download PDF` link to `/api/reports/daily?date=<value>&download=1` with the `download` attribute.
- [ ] **Step 3: Page**: for admins, render `<Suspense fallback={<TargetSectionSkeleton />}><TargetSection user={user} /></Suspense>` above the Sales & profit `Suspense`.
- [ ] **Step 4: Check** `pnpm lint`, `pnpm typecheck` — clean. Browser check (`run` skill) at desktop and phone width, light and dark: no target → link; target set → bars, squares, statuses.
- [ ] **Step 5: Commit**
  ```bash
  git add "src/app/(app)/dashboard"
  git commit -m "feat(targets): daily target card on the dashboard"
  ```

---

### Task 6: Daily report PDF

**Files:**
- Create: `src/components/print/daily-report-pdf.tsx`, `src/app/api/reports/daily/route.tsx`

**Interfaces:**
- Consumes: `getDailyTargetReport`, `parseReportDate`, `DailyTargetReport`.
- Produces: `DailyReportPdf({ data, printedAt }: { data: DailyTargetReport; printedAt: Date })`; `GET /api/reports/daily`.

- [ ] **Step 1: `DailyReportPdf`**, styled like `invoice-pdf.tsx` (same fonts and `StyleSheet` approach), A4 portrait, content per spec §5: header (business name, address, phone; `Daily sales report`; date as `EEEE, d MMMM yyyy`; `Printed <formatDateTime(printedAt)>`); **The day** block (status word in capitals `HIT` / `MISSED` / `IN PROGRESS` / `CLOSED` / `NO TARGET`, over/short amount, invoices, average sale, cash sales, credit sales, money collected, same weekday last week with ▲/▼ % or `No sales then`); **The month so far** block (MTD, month target, %, `H of N days hit`, need-per-day line, MTD vs same days last month with ▲/▼ %); **Day by day** table for `month.days` up to the report date (date, weekday, net sales, target or `—`, status) with a totals row (MTD, `paceTarget`); the foot note.
- [ ] **Step 2: Route**, mirroring `src/app/api/quotations/[id]/pdf/route.tsx`: no session → 401 `Sign in required`; `user.role !== "admin"` → 403 `Admins only`; `parseReportDate(searchParams.get("date"), colomboDate())` null → 400 `Choose a date up to today`; `Content-Disposition` `attachment; filename=daily-sales-<date>.pdf` with `download=1`, else `inline`.
- [ ] **Step 3: Check** `pnpm typecheck`, `pnpm lint` — clean. Open `/api/reports/daily` signed in as admin in the browser and read the PDF: figures match the dashboard card.
- [ ] **Step 4: Commit**
  ```bash
  git add src/components/print/daily-report-pdf.tsx src/app/api/reports
  git commit -m "feat(targets): daily sales report PDF"
  ```

---

### Task 7: End-to-end tests and full verification

**Files:**
- Create: `e2e/sales-target.spec.ts`
- Modify: `e2e/permissions.spec.ts`

- [ ] **Step 1: Write** `e2e/sales-target.spec.ts` (runs after `full-flow`, which issues invoices today worth more than Rs 1,000; today = `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date())`):
  ```ts
  test("admin sets a daily target, sees it hit and downloads the report", async ({ page }) => {
    // login admin → /dashboard → expect text "No daily target yet"; click "Set a daily target"
    // fill "Daily target (Rs)" with 1000, leave weekdays unticked, "Save target" → toast "Sales target saved"
    // "Add closed date": tomorrow, reason "Vesak Poya" → listed; Remove it → gone
    // /dashboard → expect "Daily target" and /Hit · Rs .* over/
    // click "Download PDF" inside page.waitForEvent("download") → suggestedFilename() === `daily-sales-${today}.pdf`
  });
  ```
- [ ] **Step 2: Add** to `e2e/permissions.spec.ts`: `hides the daily target` — staff `/dashboard` has no text `Daily target`; `page.request.get("/api/reports/daily")` status 403.
- [ ] **Step 3: Run** the whole suite (the new spec needs `full-flow` first): `pnpm test:e2e` — Expected: all pass. Then `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` — Expected: all green.
- [ ] **Step 4: Commit**
  ```bash
  git add e2e/sales-target.spec.ts e2e/permissions.spec.ts
  git commit -m "test(targets): daily target e2e and staff permissions"
  ```

---

### Task 8: Rollout

- [ ] **Step 1: Ask the user** before touching the hosted database: "Apply migration 0010_sales_targets to the Supabase project (it serves production) now?" Wait for a yes.
- [ ] **Step 2: Apply** `drizzle/0010_sales_targets.sql` with the Supabase MCP `apply_migration` (name `0010_sales_targets`), using the file as stored in git (`git show HEAD:drizzle/0010_sales_targets.sql`, LF endings).
- [ ] **Step 3: Insert the drizzle tracking row**: `insert into drizzle.__drizzle_migrations (hash, created_at) values ('<sha256 of the LF file>', <journal "when" for 0010>)`. Verify: `select count(*) from drizzle.__drizzle_migrations` → 11; both tables exist with RLS on.
- [ ] **Step 4: Run** `get_advisors` (security) — expected: only the known "RLS enabled, no policy" INFO for the two new tables.
- [ ] **Step 5: Ship** with `superpowers:finishing-a-development-branch`: PR `feature/sales-target` → `development`, then the release PR `development` → `main`, only as the user asks.
