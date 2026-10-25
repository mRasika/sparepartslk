# Sparepartslk — Customer Credit Summary — Design Spec

- **Date:** 2026-10-25
- **Status:** Draft for review
- **Scope:** Stage 2 of the admin analytics (see `2026-10-25-sales-profit-dashboard-design.md` §7). Stock health and "problems to watch" stay for later stages.

## 1. Context & goals

Most customers buy on credit. The app already lists every unpaid invoice (Payments › Outstanding, with an "Overdue only" filter), shows each customer's statement and balance, and the dashboard's "Needs attention" list shows the total overdue and links to that list. What is missing is the **summary**: how late the money is, who owes the most, who is over their credit limit, and whether customers are paying faster or slower.

**Users.** Admin and staff. The page shows only what customers owe and how late, never cost or profit; staff already see Payments › Outstanding and take payments.

**Success criteria**
- From one screen the owner can see how much is owed, how much is overdue, how late it is, and which customers to chase first.
- Every figure reconciles with the existing invoice list: the total owed equals the sum of the open invoices below it, and the aging groups add up to it.
- No new tables, no database change.

## 2. Placement

The summary goes **at the top of Payments › Outstanding** (`/payments?view=outstanding`), above the existing invoice list. No new sidebar item. The "Needs attention" overdue row keeps linking to `/payments?view=outstanding&overdue=1`.

```
Payments          [Received] [Outstanding]                        [Receive payment]

[Owed]            [Overdue]            [Due in next 7 days]   [Days to collect]
 Rs 81,508.50      Rs 11,170.00         Rs 24,300.00           38 days
 12 customers      14% · 3 customers    5 invoices             last 90 days

How late   ████████████▓▓▓▒▒░  Not due · 1–30 days · 31–60 · 61–90 · Over 90  (each with its amount)

Who owes            [Most owed] [Most overdue]
Customer | Owed | Overdue | Oldest late | Credit limit used | Last paid

Invoices (existing list; filters: All unpaid · Overdue only · or one aging group)
```

## 3. Definitions

All dates are Colombo business dates (`colomboDate()`). "Open invoice" and "owed" come from the existing `outstandingInvoices()`: issued invoices whose total minus active payment allocations and credit notes (capped at the total) is above 0.

| Figure | Definition |
|---|---|
| **Owed** | Sum of `outstanding` over open invoices. Sub-line: number of customers with an open invoice. |
| **Unapplied credit** | Per customer: owed on open invoices − account balance (`customerBalance`: issued totals − active payments − credit notes). When > 0 it is money paid that isn't matched to an invoice. If the sum over customers is > 0, a note under Owed reads "Rs X paid in advance, not yet matched to invoices". |
| **Overdue** | Sum of `outstanding` over open invoices with `due_date < today`. Sub-line: % of owed (whole %, "0%" when owed is 0) and number of customers with an overdue invoice. |
| **Due in next 7 days** | Sum of `outstanding` over open invoices with `today ≤ due_date ≤ today + 6`. Sub-line: number of those invoices. |
| **Days to collect (DSO)** | `owed ÷ credit sales in the last 90 days × 90`, rounded to whole days. Credit sales = sum of `total` of issued invoices with `payment_type = 'credit'` and `invoice_date` in `[today − 89, today]`. When credit sales are 0: shows "—" with the sub-line "no credit sales in 90 days". |
| **Aging group** | By days past due (`today − due_date`): ≤ 0 → **Not due**; 1–30 → **1–30 days**; 31–60 → **31–60 days**; 61–90 → **61–90 days**; ≥ 91 → **Over 90 days**. Each group: sum of `outstanding` and invoice count. Groups always sum to Owed. |

**Who owes** — one row per customer with an open invoice:
- **Owed**: sum of their open invoices' `outstanding`. **Overdue**: the part with `due_date < today` (or "—").
- **Oldest late**: the largest `days_overdue` among their open invoices ("—" when none is overdue).
- **Credit limit used**: owed ÷ `credit_limit` as a whole %, with a small bar capped visually at 100%; **Over limit** badge when owed > credit limit. When `credit_limit` is 0 the cell shows "No limit set".
- **Last paid**: date of their latest active, non-refund payment ("Never" when none).
- Sort: `?by=owed` (default) — owed desc, then name; `?by=overdue` — overdue desc, then oldest late desc, then name. Each row links to `/customers/<id>`.
- Every customer with an open invoice is listed (no top-N cut); the shop has hundreds of customers at most.

## 4. Invoice list filter

The existing list keeps "All unpaid" and "Overdue only". Clicking an aging group (in the bar or its legend) adds `late=not-due|1-30|31-60|61-90|90+`; the list then shows only that group's invoices, with a line "Showing 31–60 days late · Show all". An unknown `late` value is ignored (all unpaid). `overdue=1` keeps its meaning (all overdue groups). `by` and `late` are kept when switching the other.

## 5. Look

- Four summary tiles in the same card style as the dashboard KPI tiles (2 columns on phones).
- The aging bar: one segment per non-empty group, widths by amount, a 2px gap between segments. Colours: **Not due** neutral grey; the late groups one hue stepping darker with lateness (sequential ramp), validated with the dataviz palette checker in both themes. Each group's amount and label are always printed as text beside the bar, so colour never carries meaning alone.
- "Who owes" is a table in the existing table style; on phones it hides Oldest late and Last paid.
- Light and dark themes both.

## 6. Architecture

- **`src/lib/aging.ts`** — pure, no database:
  - `agingGroup(dueDate, today)` → group key.
  - `summarizeCredit(input)` → tiles, groups, customer rows, from plain arrays (open invoices, customer facts, credit sales, today). Money as strings via `@/lib/money`.
- **`src/server/services/credit.ts`** — `getCreditSummary(): Promise<CreditSummary>`: runs `outstandingInvoices()` (reused, so Owed matches the list), one query for customer facts (credit limit, account balance, last payment date) for customers with open invoices, one query for 90-day credit sales; passes them to `summarizeCredit`. No role check beyond the page's `requireUser()` (admin and staff).
- **UI** — `src/app/(app)/payments/credit-summary.tsx` (server component) rendered at the top of the Outstanding view; the existing `Outstanding` component gains the `late` filter. Search params: `view`, `overdue`, `late`, `by`.

## 7. Testing

- `tests/lib/aging.test.ts`: group boundaries (due today → Not due; 1 and 30 days late → 1–30; 31 → 31–60; 60 → 31–60; 61 → 61–90; 90 → 61–90; 91 → Over 90); groups sum to owed; overdue %, due in next 7 days (today and today+6 in, today+7 out); DSO including no credit sales; limit used %, over limit, no limit set; unapplied credit; both sort orders.
- `tests/services/credit.test.ts` (local Supabase): partial payment, a return (credit note), an overpayment leaving unapplied credit, a back-dated overdue invoice, a cancelled invoice ignored, last paid date; Owed equals the sum of `outstandingInvoices()`.
- `e2e/credit.spec.ts`: staff opens Outstanding, sees the four tiles and "Who owes", clicks an aging group and the list filters, "Show all" clears it.
- Visual check light/dark, desktop/phone. Full suite green before the PR into `development`.

## 8. Out of scope

- Reminders (SMS/WhatsApp), promise-to-pay notes, follow-up history.
- A per-customer aging column set (five amount columns per customer) — the table shows owed/overdue/oldest late instead.
- Charts of DSO over time.
