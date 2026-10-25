# Sparepartslk — Sales & Profit Dashboard — Design Spec

- **Date:** 2026-10-25
- **Status:** Draft for review
- **Scope:** Stage 1 of the admin analytics (phase 2 of the MVP spec). Customer credit, stock health and "problems to watch" are later stages.

## 1. Context & goals

The owner wants to see how the business is doing from the dashboard. Research on parts-store KPIs (parts-manager KPI guides, inventory analytics tools, AR dashboard guides) pointed to four areas: sales & profit, customer credit, stock health and problems to watch. The owner chose **sales & profit** as the first stage.

The MVP already records what this needs: every invoice line stores its cost at the moment of sale (`invoice_items.unit_cost`), returns record whether items went back to stock, and parts link to categories, brands and bike models.

**Users.** Admins see the new section. Staff keep the current "Today" view (today's sales, unfinished invoices, owed, overdue, low stock) and never see cost or profit; the server never sends them the analytics data.

**Success criteria**
- The admin can see net sales, gross profit, margin and average sale for any period in one page load, with the change against a comparable earlier period.
- The admin can see which parts, categories, brands and bike models earn the most, by sales or by profit.
- The numbers reconcile: top-part figures add up to the period total, and cancelled invoices, VAT and returns are handled as defined in §3.

## 2. Page layout

The current top of `/dashboard` is unchanged for everyone. Below it, admins get a **Sales & profit** section:

```
Sales & profit   [This week][This month][Last month][Last 3 months][This year][Custom]

[Net sales]      [Gross profit]   [Margin]        [Avg sale]
 Rs 1,245,300     Rs 312,800       25.1%           Rs 4,120
 ▲ 12% vs Sep 1–25 ▲ 8%           ▼ 0.9 pts       302 invoices

[Sales and profit by day]   bars = net sales, line = gross profit, tooltip with exact amounts

[Cash vs credit]   one split bar: Cash 68% · Credit 32%, with amounts

[Top sellers]  tabs: Parts | Categories | Brands | Bike models    sort: Sales | Profit
 # | Name | Qty | Sales | Profit | Margin      (top 10)
```

**Period selection**
- Presets: **This week**, **This month** (default), **Last month**, **Last 3 months**, **This year**.
- **Custom** opens a popover with From / To date inputs (same `type="date"` inputs as the invoice list filter) and an Apply button.
- The period lives in the URL: `?period=week|month|last-month|3-months|year` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. The top-sellers tab and sort are also URL params (`?top=parts|categories|brands|models&sort=sales|profit`), so the page renders on the server and a refresh or bookmark keeps the view.

**Details**
- Change tiles show `▲`/`▼` with a %; margin shows the change in percentage points. When the comparison value is 0, the tile shows "No sales before" instead of a %.
- Bike models tab: a part that fits several models counts toward each, so the totals overlap. A note under the table says so.
- Phone width: tiles in two columns; the table hides Qty and Margin.
- Empty period: tiles show Rs 0 and the chart and table show "No sales in this period".

## 3. Definitions

All dates are business dates in Colombo time (`colomboDate`). Weeks start on Monday.

| Measure | Definition |
|---|---|
| Invoice net sales | `subtotal − discount_total` of invoices with `status = 'issued'` and `invoice_date` in the period. VAT is excluded. |
| Return net amount | `sales_returns.subtotal × (invoice.subtotal − invoice.discount_total) / invoice.subtotal` (0 when the invoice subtotal is 0), counted on `return_date`. |
| **Net sales** | Invoice net sales − return net amounts in the period. |
| Cost | Σ `invoice_items.unit_cost × qty` of those invoices − Σ cost of returned items with `restock = true` in the period (at the original line's `unit_cost`). Items not restocked keep their cost: they are a loss. |
| **Gross profit** | Net sales − cost. |
| **Margin** | Gross profit ÷ net sales (shown as "—" when net sales ≤ 0). |
| **Avg sale** | Invoice net sales ÷ number of issued invoices (returns not subtracted). |
| Cash vs credit | Invoice net sales split by `invoices.payment_type`. Returns are not split. It shows how the shop sold, not how it got paid. |

**Per-line figures (top sellers).** A line's net amount is `line_total × (subtotal − discount_total) / subtotal` of its invoice, so the invoice-level discount is shared across lines in proportion and part totals add up to invoice net sales (each row is rounded to cents, so a sum can differ by at most Rs 0.01 per row). Returned lines subtract their net amount (the return ratio above applied to `sales_return_items.line_total`), their qty, and — when restocked — their cost. Parts with no category or brand appear as "Uncategorised" / "No brand". Parts with no bike model are left out of the Bike models tab.

## 4. Periods and comparison

| Period | Range | Compared with | Chart buckets |
|---|---|---|---|
| This week | Monday → today | Previous Monday → same weekday | day |
| This month | 1st → today | Same day numbers of the previous month, clamped to its last day (Mar 1–31 → Feb 1–28) | day |
| Last month | Full previous month | Full month before it | day |
| Last 3 months | Today − 3 months + 1 day → today | The same number of days just before | week |
| This year | Jan 1 → today | Jan 1 → same date last year (Feb 29 → Feb 28) | month |
| Custom | From → To | The same number of days just before From | day ≤ 31 days, week ≤ 92 days, else month |

- Custom range rules: To ≥ From, To ≤ today, at most 3 years long. Invalid or missing params fall back to **This month**.
- Week buckets start on Monday; the first and last buckets may be partial and are labelled by their start date. Buckets with no sales show 0 (generated with `generate_series`), so the chart has no gaps.

## 5. Architecture

- **`src/lib/periods.ts`** — pure functions: parse URL params → `{ from, to, compareFrom, compareTo, bucket, label }`. No database, fully unit-tested.
- **`src/server/services/sales-analytics.ts`** — `requireRole(user, "admin")`, then runs in parallel:
  1. `getSalesTotals(range)` for the period and for the comparison range: net sales, cost, invoice count, cash and credit net sales.
  2. `getSalesTrend(range, bucket)`: the same measures per bucket.
  3. `getTopSellers(range, dimension, sort)`: top 10 for the open tab only.
  Money stays as strings/`Decimal` via `@/lib/money`, like the other services.
- **UI** — `src/app/(app)/dashboard/sales-section.tsx` (server component, rendered only for admins inside its own `Suspense` with a skeleton; it catches its own query errors and shows "Couldn't load sales figures" so a failure there leaves the Today part working), with small client components for the period picker and the chart. Charts use the shadcn `chart` component (Recharts); `recharts` is the one new dependency.
- **Migration** — add index `sales_returns_return_date_idx` on `sales_returns(return_date)`. `invoices_invoice_date_idx` already exists. Applied locally, then on staging the same way as earlier migrations.

**Performance.** Queries filter on indexed dates and aggregate in SQL. Check with a seeded local database of ~20k invoices that the section renders in well under a second before calling it done.

## 6. Testing

- `tests/lib/periods.test.ts` — every preset's range, comparison and bucket; month-end clamping; Feb 29; Monday weeks; custom range validation and fallback.
- `tests/services/sales-analytics.test.ts` (local Supabase, like the other service tests) — cancelled invoices excluded; VAT excluded; invoice discount shared so top parts add up to the total; a return lowers net sales in its own period; restocked vs not-restocked cost; cash/credit split; "Uncategorised" / "No brand"; bike models overlap; empty buckets are 0; staff are refused.
- `e2e/permissions.spec.ts` — staff do not see the Sales & profit section.
- `e2e/sales-dashboard.spec.ts` — admin switches presets, applies a custom range, switches top-seller tabs and sort.
- Visual check at desktop and phone width.

## 7. Out of scope (later stages)

- Customer credit: receivables aging, top debtors, over-limit customers, DSO, due this week.
- Stock health: stock value, dead stock (no sale in 12 months), stock aging, ABC classes, turnover.
- Problems to watch: returns by part/brand, discounts given, sales by staff, cancelled invoices.
- Lost-sales tracking (customer asked for a part that was not in stock) — needs a new way to record requests.
- Precomputed daily summary tables — only if live queries become slow.
