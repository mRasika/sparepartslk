# Sparepartslk — Stock Management & Billing MVP — Design Spec

- **Date:** 2026-10-22
- **Status:** Draft for review
- **Scope:** MVP (phase 1). Analytics/charts are phase 2.

## 1. Context & goals

The client sells motorbike spare parts to businesses (B2B) from a single store in Sri Lanka. He needs:

1. **Stock management.** Know what is on hand and see low-stock items at a glance.
2. **Billing.** Issue invoices (cash or credit), take payments, handle returns.

Phase 2 will add charts for profit, sales and expenses. The MVP must already record the data those reports need: an append-only stock ledger, plus the cost price saved on every invoice line at the moment of sale.

**Success criteria**
- Staff can find a part (by SKU, OEM number, name, barcode or bike model) and issue a printed invoice in under a minute.
- Stock on hand is always correct and explainable: every change traces to a document and a user.
- The owner can see, at any time, which parts are low, who owes money, and which invoices are overdue.
- Invoices are numbered sequentially with no gaps and are never deleted.

## 2. Decisions

| Topic | Decision |
|---|---|
| Locations | Single store/warehouse. One quantity per part. |
| VAT | Setting: `vat_enabled` + `vat_rate`. When on, the invoice is titled **TAX INVOICE** and shows supplier and buyer TIN, a VAT breakdown and a sequential serial (IRD format). When off, it is a plain commercial invoice. |
| Payment terms | Mixed cash and credit. Tracks receivables, partial payments and overdue invoices. |
| Stock in | GRN (Goods Received Note) per supplier delivery, with cost price. Weighted average costing. |
| Users | Roles `admin` (owner) and `staff`. `created_by` on every document. |
| Platform | Cloud web app: Next.js 15 (App Router, TypeScript), Supabase (Postgres + Auth), Drizzle ORM, shadcn/ui + Tailwind, Vercel. |
| Pricing | Price tiers (e.g. Retail / Dealer / Wholesale), one tier per customer, plus line and invoice discounts. Staff discount is capped at `staff_max_discount_pct`. |
| Printing | A4 (print + PDF download) and 80mm thermal receipt. |
| Returns | Sales returns with credit notes are in scope. |
| Stock consistency | App-managed ledger + stored `qty_on_hand`, updated in one locked transaction. Nightly check against the ledger. |
| Negative stock | Not allowed. An invoice is rejected if stock is insufficient. |

**Compliance note:** the IRD standard tax invoice format has been gazetted and postponed several times (Gazettes 2463/05, 2481/22, 2500/106). Before go-live, check the current mandatory fields on ird.gov.lk / documents.gov.lk and adjust the A4 template. Original documents must be kept for at least 5 years, so issued documents are never deleted.

## 3. Scope

### In scope (MVP)
1. **Auth & users.** Email/password sign-in via Supabase Auth. Admin creates, deactivates and assigns roles to users.
2. **Settings.** Business name, address, phone, email, TIN, logo; VAT toggle and rate; document prefix; Staff maximum discount %; default credit days.
3. **Catalog.**
   - Parts: SKU (unique), OEM part number, barcode, name, category, brand, unit, bin location, reorder level, reorder quantity, active flag.
   - A price per tier.
   - Fitment to bike models (make, model, year range).
4. **Suppliers & GRN.** Supplier list. A GRN records supplier, the supplier's invoice number, date and lines (part, qty, unit cost).
5. **Customers.** Name, business name, phone, address, TIN, price tier, credit limit, credit days, active flag. Account statement.
6. **Billing.**
   - Keyboard-first invoice screen with prices filled from the customer's tier, line discounts and an invoice discount, cash or credit, and VAT if enabled.
   - Print A4, download PDF, or print an 80mm receipt.
   - Admin can cancel an invoice.
7. **Payments.**
   - Receive payment by cash, bank transfer or cheque, with a reference.
   - The payment is applied to open invoices, oldest first by default; Admin can apply it by hand.
   - Outstanding and overdue list.
8. **Sales returns / credit notes.** Raised against an original invoice. Goods are restocked unless marked "damaged, don't restock".
9. **Stock control.** Stock list, low-stock list with suggested quantity and CSV export, stock adjustments with a reason, and each part's movement history.
10. **Dashboard.** Numbers only: today's sales total, invoice count, low-stock count, total outstanding, total overdue.

### Out of scope (later phases)
- Charts and profit/expense reports (phase 2)
- Purchase orders
- Multiple locations
- Offline mode
- Accounting export
- SMS/WhatsApp sending
- Supplier payables
- Barcode label printing

## 4. Data model

PostgreSQL. All money is `numeric(12,2)` and all quantities are `integer`; parts are sold in whole units, and pack items are their own SKU. Primary keys are `uuid`. Every document has `created_by` (→ profiles) and `created_at`.

### Reference
- `profiles`: `user_id` (PK, = auth.users.id), `full_name`, `role` (`admin`|`staff`), `is_active`
- `settings`: single row. `business_name`, `address`, `phone`, `email`, `tin`, `logo_url`, `vat_enabled`, `vat_rate`, `staff_max_discount_pct`, `default_credit_days`, `doc_prefix`
- `categories`: `name`
- `brands`: `name`
- `vehicle_models`: `make`, `model`, `year_from`, `year_to`
- `price_tiers`: `name`, `is_default`

### Catalog
- `parts`:
  - identity: `sku` UNIQUE, `oem_part_no`, `barcode` UNIQUE NULL, `name`, `category_id`, `brand_id`, `unit`, `bin_location`
  - stock: `qty_on_hand` (≥ 0 check), `avg_cost`, `reorder_level`, `reorder_qty`
  - flags: `is_active`
- `part_prices`: (`part_id`, `tier_id`) PK, `price`
- `part_fitments`: (`part_id`, `vehicle_model_id`) PK

### Parties
- `customers`: `name`, `business_name`, `phone`, `address`, `tin`, `tier_id`, `credit_limit` (0 = cash only), `credit_days`, `is_active`. The **walk-in** customer is seeded and is cash only.
- `suppliers`: `name`, `phone`, `address`, `tin`, `is_active`

### Documents
- `grns`: `number`, `supplier_id`, `supplier_invoice_no`, `received_date`, `total`, `note`
- `grn_items`: `grn_id`, `part_id`, `qty` (> 0), `unit_cost`
- `invoices`:
  - `number`, `customer_id`, `invoice_date`, `due_date`
  - `payment_type` (`cash`|`credit`), `tier_id` (snapshot), `vat_rate` (snapshot, 0 if VAT off)
  - `subtotal`, `discount_total`, `vat_amount`, `total`
  - `status` (`issued`|`cancelled`), `cancel_reason`, `cancelled_by`, `cancelled_at`
- `invoice_items`: `invoice_id`, `part_id`, `description` (snapshot), `qty`, `unit_price`, `discount`, `line_total`, `unit_cost` (snapshot of avg_cost)
- `sales_returns`: `number` (credit note), `invoice_id`, `customer_id`, `return_date`, `reason`, `total`
- `sales_return_items`: `return_id`, `invoice_item_id`, `part_id`, `qty`, `unit_price`, `line_total`, `restock` (bool)
- `payments`: `number`, `customer_id`, `payment_date`, `amount`, `method` (`cash`|`bank`|`cheque`), `reference`, `is_refund`, `status` (`active`|`cancelled`)
- `payment_allocations`: `payment_id`, `invoice_id`, `amount`
- `stock_adjustments`: `number`, `reason`, `note`
- `stock_adjustment_items`: `adjustment_id`, `part_id`, `qty_change` (≠ 0)

### Core
- `stock_movements` (append-only ledger; the app never updates or deletes rows):
  - `part_id`, `type` (`GRN`|`SALE`|`SALE_CANCEL`|`RETURN`|`ADJUST`)
  - `qty_change`, `balance_after`, `unit_cost`
  - `ref_type`, `ref_id`, `created_by`, `created_at`
- `document_sequences`: (`doc_type`, `year`) PK, `next_no`. Doc types are INV, GRN, CRN, PAY and ADJ, formatted as `INV-2026-000123`.
- `stock_reconciliation_issues`: `part_id`, `stored_qty`, `ledger_qty`, `detected_at`, `resolved_at`

### Derived values (not stored)
- **Invoice settled** = SUM(allocations) + SUM(credit notes against it), capped at total. **Outstanding** = total − settled.
- **Customer balance** = SUM(issued invoice totals) − SUM(payments, refunds are negative) − SUM(credit notes). A negative balance means the store owes the customer credit.
- An invoice is **overdue** when outstanding > 0 and `due_date < today`.

Indexes: `parts(sku)`, `parts(oem_part_no)`, `parts(barcode)`, a trigram index on `parts(name)` for search, `stock_movements(part_id, created_at)`, `invoices(customer_id, status)`, `invoices(invoice_date)`.

## 5. Business flows

Every flow below runs in **one database transaction** inside a service function. Any error rolls the whole thing back.

### 5.1 Create invoice
1. Validate input with zod: at least one line, qty > 0, prices ≥ 0.
2. Resolve unit prices from the customer's tier, or the default tier if the part has no price for that tier.
3. **Discount check:** if the user is Staff, each line discount and the invoice discount must be ≤ `staff_max_discount_pct` of the amount. Otherwise raise `DiscountNotAllowed`.
4. **Lock parts:** `SELECT … FROM parts WHERE id IN (…) ORDER BY id FOR UPDATE`. The fixed order prevents deadlocks.
5. **Stock check:** for each part, `qty_on_hand ≥ requested` (summed if a part appears on several lines). Otherwise raise `InsufficientStock{part, available}`.
6. **Totals:** line_total = qty × unit_price − discount; subtotal; invoice discount; VAT = (subtotal − invoice discount) × vat_rate; total. Round half-up to 2 decimal places at line level and at the total.
7. **Credit check** (credit invoices only): customer balance + total ≤ credit_limit. Otherwise raise `CreditLimitExceeded`. Admin may pass `override_credit_limit = true`; the override is recorded on the invoice. The walk-in customer cannot buy on credit.
8. **Number:** `nextNumber('INV')` locks the `document_sequences` row (`FOR UPDATE`) and increments it, so numbers have no gaps.
9. Insert the invoice and its items, with `unit_cost = parts.avg_cost`.
10. For each line, reduce `qty_on_hand` and insert a `SALE` movement with `balance_after`.
11. **Cash invoice:** create a `PAY` payment for the total, fully allocated to this invoice.

### 5.2 Cancel invoice (Admin only)
- A reason is required.
- Not allowed if the invoice has returns, or allocations from any payment other than its own automatic cash payment.
- For a cash invoice, its automatic payment and allocation are cancelled together with it.
- Status becomes `cancelled`. The number is kept and printouts show "CANCELLED".
- Add back `qty_on_hand` and insert `SALE_CANCEL` movements at the original `unit_cost`. Average cost is recalculated the same way as for a GRN.

### 5.3 GRN
- Lock the parts in id order.
- For each line, the new average cost is `new_avg = (old_qty × old_avg + qty × unit_cost) / (old_qty + qty)`. If old_qty = 0, the new average is unit_cost.
- Add the quantity and insert `GRN` movements.
- Number via `nextNumber('GRN')`.
- GRNs cannot be edited. Mistakes are corrected with a stock adjustment, or by an Admin-only reverse GRN (out of MVP scope; use an adjustment).

### 5.4 Sales return / credit note
- Against an `issued` invoice only.
- Per line: return qty ≤ sold qty − previously returned qty. Otherwise raise `ReturnQtyExceeded`.
- Return value = qty × (line_total / sold qty), so the proportional discount is kept.
- If `restock`: lock the part, add qty, insert a `RETURN` movement at the original `unit_cost`, and recalculate the average cost.
- If not restocked (damaged): the credit is given but no movement is written.
- Number via `nextNumber('CRN')`. The credit note reduces the invoice's outstanding amount and the customer's balance.
- If the credit is more than the invoice's outstanding amount (the invoice was already paid), the extra becomes customer credit.
- **Cash refund option** (required for the walk-in customer): the return form can record a refund. It is a `payments` row with `method = cash`, `is_refund = true` and a negative amount, which takes the credit back off the account.

### 5.5 Payment
- Fields: customer, amount > 0, method, reference (required for cheque and bank).
- Default allocation goes to open invoices, oldest due date first, until the amount is used up. Admin can apply it by hand.
- SUM(allocations) ≤ amount. Any amount left over stays as **unapplied credit** on the customer's account, which still reduces the balance.

### 5.6 Stock adjustment
- A reason is required: `damage`, `count_correction`, `lost`, `other`.
- Staff may only make decreases with reason `damage` or `lost`. Admin may make any adjustment.
- Resulting qty_on_hand must be ≥ 0. Insert `ADJUST` movements.

### 5.7 Low stock
- Query: `is_active AND qty_on_hand <= reorder_level AND reorder_level > 0`.
- Suggested order quantity = `reorder_qty` if > 0, else `max(reorder_level × 2 − qty_on_hand, 1)`.
- Can be grouped by last supplier (the supplier on the part's most recent GRN).
- A badge in the navigation shows the count. Export to CSV.

### 5.8 Nightly reconciliation
- A `pg_cron` job compares `parts.qty_on_hand` with `SUM(stock_movements.qty_change)` for each part.
- Any mismatch is inserted into `stock_reconciliation_issues`, which Admin sees on the dashboard.

## 6. Roles & permissions

| Action | Staff | Admin |
|---|---|---|
| View parts, stock, low-stock list | ✓ (no cost / avg_cost) | ✓ |
| Create / edit parts, prices, fitments | — | ✓ |
| Create invoice | ✓ (discount ≤ cap, no credit-limit override) | ✓ |
| Cancel invoice | — | ✓ |
| GRN | ✓ (enters cost, but never sees avg_cost) | ✓ |
| Sales return | ✓ | ✓ |
| Receive payment (auto-allocate) | ✓ | ✓ (+ manual allocation) |
| Stock adjustment | decrease only (damage/lost) | ✓ |
| Customers / suppliers create & edit | ✓ | ✓ |
| Customer credit limit / tier change | — | ✓ |
| Settings, users | — | ✓ |

Permissions are enforced on the server in each Server Action. Cost fields are removed from the data sent to Staff.

## 7. Architecture

```
src/
  app/
    (auth)/login
    (app)/layout.tsx                      ← sidebar nav + low-stock badge, requires session
    (app)/dashboard
    (app)/parts  parts/[id]  parts/new
    (app)/stock  stock/adjustments  low-stock
    (app)/grn  grn/new  grn/[id]
    (app)/invoices  invoices/new  invoices/[id]
    (app)/returns  returns/new
    (app)/customers  customers/[id] (statement)
    (app)/payments  payments/new
    (app)/suppliers
    (app)/settings  users
    print/invoice/[id]/page.tsx           ← ?format=a4|thermal, print CSS, auto window.print()
    api/invoices/[id]/pdf/route.ts        ← @react-pdf/renderer
  server/
    db/schema.ts  db/client.ts  db/migrations/
    services/
      sequences.ts     nextNumber(tx, docType)
      inventory.ts     lockParts, applyMovement, recalcAvgCost, adjustStock, lowStock
      pricing.ts       resolvePrices, computeTotals
      invoicing.ts     createInvoice, cancelInvoice
      grn.ts           createGrn
      returns.ts       createReturn
      payments.ts      receivePayment, allocate
      customers.ts     balance, statement, outstanding/overdue
    actions/*.ts      ← getSessionUser → requireRole → zod.parse → service → map DomainError
    auth.ts           ← Supabase SSR session → profile/role
    errors.ts         ← DomainError subclasses
  components/ui/ (shadcn)  components/billing/  components/print/
```

**Rules**
- UI components never import `db`. All writes go through `services/*`, called by `actions/*`.
- Services take a transaction handle (`tx`) so they can call each other inside one transaction. Unit tests call services directly.
- Supabase is used for **Auth only**, through `@supabase/ssr`. Data access goes through Drizzle using a server-side Postgres connection (pooled connection string). RLS is switched on for all tables with no policies for `anon`/`authenticated`, so the browser can never reach data directly.
- **Money maths** uses a decimal library (`decimal.js`), never JS floats.
- **Timezone:** dates are business dates in `Asia/Colombo`.

**Invoice templates**
- **A4:** logo, business details and TIN, title (TAX INVOICE / INVOICE), number, date, due date, customer name/address/TIN, line table (SKU, description, qty, unit price, discount, amount), subtotal, discount, VAT, total, amount in words, payment type, "Prepared by" and a signature line.
- **80mm thermal:** the same content, condensed. TIN lines are shown when VAT is on.
- The PDF is generated from the same data as the A4 page.

## 8. Error handling
- `DomainError` subclasses: `InsufficientStock`, `CreditLimitExceeded`, `DiscountNotAllowed`, `ReturnQtyExceeded`, `InvalidState` (e.g. cancelling an invoice that has returns), `Forbidden`.
- Actions return `{ ok: true, data } | { ok: false, error: { code, message, field? } }`, and the UI shows the error next to the relevant field or line.
- Unexpected errors are logged on the server and the user sees a generic message. The transaction is rolled back automatically.
- Check constraints in the database (`qty_on_hand >= 0`, `qty > 0`, unique numbers) are the last line of defence.

## 9. Testing
- **Vitest service tests** run against a real Postgres database (`supabase start` locally), with schema migrated and truncated between tests. They cover:
  - average cost across several GRNs, including qty 0 → GRN
  - gapless numbering under parallel calls
  - **two simultaneous invoices for the last unit:** exactly one succeeds
  - insufficient stock, discount cap, credit limit and Admin override
  - cancel rules and stock restored
  - return quantity limits, proportional discount, restock vs damaged
  - payment auto-allocation oldest-first, partial payment, unapplied credit
  - the reconciliation query detecting a manual mismatch
- **Playwright E2E:** sign in as Admin → create part and tier prices → GRN → sign in as Staff → invoice on credit → print A4 and thermal pages render → receive payment → return one item → the low-stock list reflects the stock.
- **Manual check:** print on a real A4 printer and an 80mm printer; switch VAT on and off.

## 10. Deployment & seed
- Vercel (app) + Supabase project (DB, Auth, pg_cron). Environment variables: Supabase URL and anon key, `DATABASE_URL` (pooled), `DIRECT_URL` (migrations).
- Seed data: tiers Retail (default), Dealer and Wholesale; the walk-in cash customer; a settings row; the first Admin user (created through a script).
- Backups: Supabase daily backups. An Admin can export the parts list and stock as CSV.

## 11. Phase 2 hooks (already supported by this design)
- Profit per invoice and per part = Σ(line_total − qty × unit_cost).
- Sales trends and fast/slow movers come from `stock_movements` and `invoice_items`.
- Reorder level can later be calculated as average daily sales × lead time + safety stock.
- Expenses module: a new table with no changes to the core.
