# Sparepartslk — Stock Health — Design Spec

- **Date:** 2026-10-26
- **Status:** Draft for review
- **Scope:** Stage 3 of the admin analytics (see `2026-10-25-sales-profit-dashboard-design.md` §7). "Problems to watch" and lost-sales logging stay for later.

## 1. Context & goals

Research on parts stores named stock as where they lose the most money: parts that stop selling tie up cash, while the few fast sellers must never run out. The app already shows stock on hand per part and, for admins, stock value (qty × average cost); it records every stock movement with a timestamp and every invoice line's cost. What is missing is the **health** view: how old the stock is, which parts carry the sales, how fast stock turns, and where money is stuck.

**Users.** Admins only — every figure uses cost, which staff never see. Staff see the Stock page exactly as today.

**Success criteria**
- From the top of the Stock page the owner sees how much money is in stock, how much of it is slow or dead, how fast stock turns, which parts matter most, and what to clear first.
- Stock value equals the existing Stock page total; sales and cost figures agree with the dashboard's Sales & profit (same definitions).
- No database change.

## 2. Placement

At the top of the Stock page (`/stock`), above the existing list, for admins only.

```
[Stock value]       [Slow & dead]          [Turns per year]     [Days of stock]
 Rs 1,245,000        Rs 186,000             3.1×                 118 days
 412 parts in stock  15% · 37 parts         last 90 days         at the current sales pace

How long since it sold   ███████▓▓▒░  0–90 days · 91–180 days · 181–365 days · Over 365 days

Sales classes (last 12 months)
 A  48 parts · 80% of sales · Rs 610,000 in stock · 3 low or out of stock
 B  96 parts · 15% of sales · Rs 330,000 in stock
 C 180 parts ·  5% of sales · Rs 190,000 in stock
 No sales 88 parts · Rs 115,000 in stock

Most money stuck   (top 10 by stock value, no sale in over 180 days)
Part | On hand | Value | Last sold | Class

Stock list (existing; admins also see "Last sold" and "Class"; filters below apply)
```

## 3. Definitions

Dates are Colombo business dates (`colomboDate()`). "In stock" = `qty_on_hand > 0`. Inactive parts with stock count (the money is still on the shelf).

| Figure | Definition |
|---|---|
| **Stock value** | Σ `qty_on_hand × avg_cost` over parts in stock (same as the Stock page total). Sub-line: number of parts in stock. |
| **Last sold** | The latest `invoice_date` of an **issued** invoice line for the part (cancelled invoices ignored); none if never sold. |
| **Days since it sold** | `today − last sold`; for a part never sold, `today − first arrival`, where first arrival = the date (Colombo) of the part's earliest stock movement with `qty_change > 0`. A part in stock with no such movement counts as 0 days. |
| **Age band** | By days since it sold: ≤ 90 → **0–90 days**; 91–180 → **91–180 days**; 181–365 → **181–365 days**; ≥ 366 → **Over 365 days**. Each band: stock value and number of parts in stock. Bands always sum to Stock value. |
| **Slow & dead** | Stock value in the 181–365 and Over 365 bands. Sub-line: % of stock value (whole %, "0%" when stock value is 0) and number of parts. |
| **Cost of goods (90 days)** | The Sales & profit "cost" over `[today − 89, today]`: issued invoice line costs minus costs of restocked returns. |
| **Turns per year** | `cost of goods (90 days) × 365 / 90 ÷ stock value`, one decimal ("3.1×"). Stock value 0 → "—". |
| **Days of stock** | `stock value ÷ (cost of goods (90 days) / 90)`, whole days. No cost of goods in 90 days → "—" with sub-line "no sales in 90 days". |
| **Sales (12 months)** | Per part, the Sales & profit net sales over `[today − 364, today]`: line net of its share of the invoice discount, minus returns. |
| **ABC class** | Parts with sales (12 months) > 0, sorted by sales desc then SKU. Walking down the list with a running total: a part is **A** if the share *before* it is < 80%, **B** if < 95%, else **C**. Parts with no sales (≤ 0) are **No sales**. Per class: number of parts, % of total sales (whole %), stock value of those parts. The A row adds "N low or out of stock" for A parts that are active with `qty_on_hand ≤ reorder_level` (reorder level > 0) or `qty_on_hand = 0`, when N > 0. |
| **Most money stuck** | Parts in stock in the 181–365 or Over 365 bands, by stock value desc then SKU, top 10. Columns: part (SKU · name, links to the part), on hand, value, last sold ("Never"), class. Not shown when empty. |

## 4. Stock list additions

For admins the list gains **Last sold** (date or "Never") and **Class** (A/B/C/—) columns. Filters (links on the bands and class rows): `age=0-90|91-180|181-365|365+` (parts in stock in that band) and `class=A|B|C|none`. They combine with the existing `q`, `category` and `low` filters; a line "Showing <filter> · Show all" clears them. Unknown values are ignored. Staff: the params are ignored and nothing changes.

## 5. Look

- Four tiles in the dashboard KPI card style (2 columns on phones).
- The age bar: one segment per non-empty band (widths by value, 2px gaps) in the validated blue `--aging-1..4` ramp from the credit page (older = stronger), with every band's label and value printed as text links.
- Classes as a short list of rows (text, not a chart). "Most money stuck" as a table in the existing style; on phones it hides Last sold.
- Light and dark themes both.

## 6. Architecture

- **`src/lib/stock-health.ts`** — pure: `stockAgeBand(days)`, `abcClasses(sales)`, `summarizeStock(input)` → tiles, bands, classes, stuck list, and a per-part map `{ lastSoldOn, band, class }` for the list.
- **`src/server/services/stock-health.ts`** — `getStockHealth(user, today?)`: `requireRole(user, "admin")`; queries parts in stock, last sold per part, first arrival per part, 12-month sales per part and 90-day cost of goods (both through the Sales & profit sale-lines query, exported from `sales-analytics.ts` for reuse); passes them to `summarizeStock`.
- **UI** — `src/app/(app)/stock/stock-health.tsx` (server component) rendered above the list for admins; the page reads `age` and `class`.

## 7. Testing

- `tests/lib/stock-health.test.ts`: band boundaries (90 → 0–90, 91 → 91–180, 180, 181, 365 → 181–365, 366 → Over 365); ABC with exact sales (a part crossing 80% is A; crossing 95% is B); classes with no sales; turns and days of stock, including no stock and no sales; bands sum to stock value; stuck list order and cut at 10; A parts low or out.
- `tests/services/stock-health.test.ts` (local Supabase): last sold ignores a cancelled invoice; a never-sold part is aged from its arrival; a return lowers 12-month sales; 90-day cost of goods matches `getSalesTotals`' cost; stock value matches `stockList` for an admin; staff are refused.
- `e2e/stock-health.spec.ts`: an admin sees the tiles and filters the list by a band and by a class, "Show all" clears; staff see no summary.
- Visual check light/dark, desktop/phone. Full suite green before release.

## 8. Out of scope

- Reorder suggestions or purchase planning; supplier returns; discounting actions.
- Turnover per category or brand; history of stock value over time (would need snapshots).
- XYZ (demand variability) classes.
