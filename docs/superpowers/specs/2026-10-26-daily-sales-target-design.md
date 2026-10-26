# Sparepartslk — Daily Sales Target — Design Spec

- **Date:** 2026-10-26
- **Status:** Draft for review
- **Scope:** A daily sales target on the admin dashboard, with month pace and a downloadable daily report PDF.

## 1. Context & goals

The owner works to a daily sales target of about Rs 250,000. Today he adds up each invoice in an Excel sheet to see whether the day hit the target, and gets a PDF saying whether it did, how much was sold, and how the month is going. The app already has every figure this needs (the Sales & profit section computes net sales by day); it has no target and no report.

Research on sales-goal tools and end-of-day reports (Metorik, Lightspeed Goals, Paceloop; Solink, CellSmart and Tekmetric end-of-day guides) pointed to: progress against a pace, not only hit/miss; days hit in the month; the amount still needed per day; a day summary with cash vs credit and money actually collected; and comparisons with last week and last month.

**Decisions with the user**
- The PDF is a **download button** only. No email or WhatsApp sending, no scheduled job.
- **One daily target for every trading day**, typed in by the owner in Settings and changeable at any time. A change applies from that day on; earlier days keep the target they had.
- Sales counted toward the target are **net sales: excluding VAT, after returns** — the Sales & profit figure. Cash and credit invoices both count on their invoice date.
- **Admins only.** Staff keep the current "Today" view and never receive target data.
- The report includes the day summary, money collected and comparisons (research items a, b, c). Not profit, returns/discounts or top parts.

**Success criteria**
- The owner can stop keeping the Excel sheet: the dashboard and the PDF show each day's net sales, its target and whether it was hit, for every day of the month.
- He can see during the day how far today is from the target, and at any time how much per day the rest of the month needs.
- Changing the target or closing a day never changes whether an earlier day was hit.

## 2. Rules

All dates are Colombo business dates (`colomboDate`). Weekdays are ISO numbers: 1 = Monday … 7 = Sunday.

| Term | Definition |
| --- | --- |
| **Target row in force** on date D | The `sales_targets` row with the latest `effective_from` ≤ D. None → D has no target. |
| **Trading day** | D has a target row in force, D's weekday is not in that row's `closed_weekdays`, and D is not in `closed_days`. |
| **Day target** | The row's `daily_target` on a trading day; no target otherwise. |
| **Net sales** on D | `getSalesTotals({ from: D, to: D }).netSales` (spec 2026-10-25 §3): issued invoices' subtotal − discount, minus returns dated D, excluding VAT. Sales on a non-trading day still count toward the month. |
| **Month target** | Sum of day targets over every trading day of the calendar month (past and future days; future days use the row in force today). |
| **Month to date (MTD)** | Net sales from the 1st to the report date. |
| **Day status** | `no-target` — no target row in force yet. `closed` — a closed weekday or closed date. `upcoming` — a trading day after the report date. `hit` — net sales ≥ day target. `in-progress` — the report date is today and not yet hit. `missed` — otherwise. |
| **Days hit** | "H of N": H = days with status `hit`; N = trading days up to the report date, counting the report date only when it is `hit` or `missed` (an in-progress today is not yet counted). |
| **Need per day** | (month target − MTD) ÷ trading days after the report date. When MTD ≥ month target: "Month target reached". When no trading days are left and it isn't reached: "Missed the month by Rs X". |
| **Money collected** on D | Σ `payments.amount` with `payment_date = D` and `status = 'active'`: the automatic payments on cash invoices, credit payments received, and refunds (negative). Includes VAT — it is money, not sales. |
| **Avg sale** | Invoice net sales ÷ issued invoices on D (returns not subtracted), as in Sales & profit. |
| **Cash vs credit** | Invoice net sales on D split by `payment_type`. |
| **Same weekday last week** | Net sales on D − 7 days; change shown as ▲/▼ %, or "No sales then" when that was 0. |
| **MTD vs last month** | Net sales over the "This month" comparison range of `src/lib/periods.ts` taken at the report date (same day numbers of the previous month, clamped to its last day). |

Amounts are 2-decimal strings via `@/lib/money`; percentages are rounded to whole numbers for the bars and the PDF.

## 3. Dashboard card

Admins only, on `/dashboard` above the Sales & profit section, in its own `Suspense` with a skeleton; a query error shows "Couldn't load the sales target" there and leaves the rest of the page working (same pattern as the Sales & profit section).

```
Daily target  · net sales, excl. VAT                       Report for [2026-10-26] [Download PDF]
Today  Rs 182,400 of Rs 250,000   ███████████░░░░ 73%    In progress · Rs 67,600 to go
Month  Rs 3,410,000 of Rs 6,500,000 · 26 trading days     ████████░░░│░ 52%   (│ = where it should be today)
       14 of 20 days hit · Need Rs 257,500 a day for the 12 trading days left
       ▢▢▢▢ … one square per day: green hit · red missed · grey closed or no target · outlined upcoming · ring = today
```

- **Today line:** "Hit · Rs 12,300 over" once reached; "In progress · Rs X to go" before. If today is not a trading day: "Closed today" and the sales so far.
- **Pace mark** on the month bar: the share of the month target belonging to trading days up to and including today.
- **Day squares:** each has an accessible label and tooltip, e.g. "Thu 3 Oct: Rs 260,000 of Rs 250,000 — hit". A small legend below.
- **No target set yet:** the card shows "No daily target yet" and a link "Set a daily target" to Settings.
- **Report picker:** a date input (default today, max today) and **Download PDF** → `/api/reports/daily?date=…&download=1`.
- Phone width: the two lines stack, the squares wrap in rows of 7–8.

## 4. Settings

A new **Sales target** section on `/settings` (admins only, like the rest of the page), with its own Save button and server action.

- **Daily target (Rs):** required, > 0, ≤ 99,999,999.99.
- **Closed weekdays:** seven tick boxes, Monday … Sunday. At least one weekday must stay open.
- **Save** writes a `sales_targets` row with `effective_from = today`. Saving again the same day replaces today's row (upsert on `effective_from`). Earlier rows are never changed. Below the form: "In force since <date>" and the previous values, if any.
- **Closed dates:** a list of upcoming closed dates (today onward), each with its reason and a Remove button, and an Add form: date (min today) and reason (optional, ≤ 100 characters, e.g. "Vesak Poya"). Past closed dates can't be added or removed, so a missed day can't be turned into a closed one afterwards. Adding a date that is already closed is refused: "<date> is already closed".

## 5. Daily report PDF

`GET /api/reports/daily?date=YYYY-MM-DD[&download=1]`, A4 portrait, `@react-pdf/renderer` like the invoice PDF.

- Signed out → 401. Staff → 403 "Admins only". `date` missing → today. `date` invalid or after today → 400 "Choose a date up to today". No target in force on any day of the month → the report still renders, with "No target set" in place of targets.
- `Content-Disposition`: `attachment; filename=daily-sales-<date>.pdf` with `download=1`, else `inline`.

**Content**
1. Header: business name, address, phone (from settings); title **Daily sales report**; the date as "Saturday, 26 October 2026"; "Printed <date time>".
2. **The day:** net sales · target · **HIT** / **MISSED** / **IN PROGRESS** / **CLOSED** with "Rs X over" or "Rs X short"; invoices and average sale; cash sales and credit sales; money collected; same weekday last week with ▲/▼ %.
3. **The month so far:** MTD · month target · % · days hit "H of N" · need per day (or "reached" / "missed by"); MTD vs the same days last month with ▲/▼ %.
4. **Day by day:** one row per day from the 1st to the report date: date, weekday, net sales, target (— on closed and no-target days), status. A totals row: MTD sales and the target of trading days so far.
5. Foot note: "Net sales exclude VAT and are after returns. Money collected includes VAT."

## 6. Architecture

- **Migration `0010_sales_targets`**
  - `sales_targets`: `id uuid pk`, `effective_from date not null unique`, `daily_target numeric(12,2) not null check (daily_target > 0)`, `closed_weekdays smallint[] not null default '{}'` with checks `closed_weekdays <@ '{1,2,3,4,5,6,7}'` and `cardinality(closed_weekdays) < 7`, `created_by uuid not null → profiles.user_id`, `created_at timestamptz default now()`.
  - `closed_days`: `day date pk`, `reason text`, `created_by uuid not null → profiles.user_id`, `created_at timestamptz default now()`.
  - RLS enabled with no policies, like every other app table.
  - Applied locally by the test setup; on the Supabase project (it serves production) via MCP + the drizzle tracking row, **before** the code is merged and only after the user says go.
- **`src/lib/sales-target.ts`** — pure functions, no database:
  - `targetOn(date, rows)`, `isTradingDay(date, rows, closedDays)`.
  - `monthPlan({ reportDate, today, rows, closedDays, dailySales })` → `{ days: { date, target, sales, status }[], monthTarget, mtd, daysHit, daysCounted, tradingDaysLeft, needPerDay, paceTarget, outcome }` where `outcome` is `"on-track" | "reached" | "missed"` and `paceTarget` is the target of trading days up to the report date.
- **`src/server/services/sales-targets.ts`** — `requireRole(user, "admin")` on every function:
  - `getTargetSettings()`, `saveSalesTarget(user, input)`, `addClosedDay(user, input)`, `removeClosedDay(user, day)`.
  - `getDailyTargetReport(user, date)` → settings header, the day summary (from `getSalesTotals`), money collected, last-week and last-month comparisons, and `monthPlan` fed by `getSalesTrend(month 1st → report date, "day")`. Queries run in parallel.
- **Actions** `src/server/actions/sales-targets.ts`; revalidate `/dashboard` and `/settings`.
- **UI** — `src/app/(app)/dashboard/target-section.tsx` (server component) with a small client component for the report date picker; `src/app/(app)/settings/sales-target-form.tsx` and `closed-days.tsx`; `src/components/print/daily-report-pdf.tsx`; route `src/app/api/reports/daily/route.tsx`.

## 7. Testing

- `tests/lib/sales-target.test.ts` — target row in force across a mid-month change; closed weekdays and closed dates; days before the first target; month target; days hit with today in progress vs hit; need per day, reached, and missed on the last trading day; a month with every remaining day closed; 28/29/30/31-day months.
- `tests/services/sales-targets.test.ts` (local Supabase) — saving twice on one day keeps one row; a later change leaves earlier days' status unchanged; closed-date rules (no past dates, no duplicates, remove only today onward); report figures: net sales after a return, VAT excluded, cancelled invoices ignored, money collected includes credit payments and refunds; staff refused everywhere.
- `e2e/sales-target.spec.ts` — admin sets Rs 1,000 in Settings, sells, sees "Hit" on the dashboard, downloads the PDF (200, `application/pdf`).
- `e2e/permissions.spec.ts` — staff don't see the Daily target card and get 403 from the report route.
- Visual check at desktop and phone width, light and dark.

## 8. Out of scope

- Emailing or sending the report automatically.
- Targets per weekday, per month or per staff member; sales by staff.
- Profit, returns, discounts or top parts in the report.
- Closing past days or editing past targets.
- Showing the target to staff.
