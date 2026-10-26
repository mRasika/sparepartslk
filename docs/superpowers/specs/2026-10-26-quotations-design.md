# Sparepartslk — Quotations — Design Spec

- **Date:** 2026-10-26
- **Status:** Draft for review
- **Scope:** Numbered quotations that can be printed, sent as a PDF, and converted into an invoice. From the industry research backlog ("quotations as printable drafts").

## 1. Context & goals

Customers — garages, fleet owners, people phoning in — ask "how much for these parts?" before they buy. Today staff can only start an invoice draft, which has no number, can't be printed, is deleted after 7 days and re-prices itself when reopened. There is no document the shop can hand over that says "these prices, until this date".

**Users.** Everyone who can make invoices (admin and staff).

**Success criteria**
- Staff make a numbered quotation (`QUO-2026-000001`) for a saved customer or a walk-in with a typed name and phone, print it on A4 or download a PDF to send on WhatsApp.
- When the customer comes back, one click opens the invoice editor filled from the quotation; staff can drop lines or change quantities, then issue as usual.
- While the quotation is valid, the invoice uses the quoted prices; after it expires, today's prices, with the changes shown.
- A quotation never moves stock, never counts toward a balance, a payment or any dashboard figure.
- Every existing invoice rule (stock check, credit limit and admin override, discount cap, gapless numbering) still applies on conversion.

## 2. What a quotation is

| Field | Notes |
| --- | --- |
| Number | `QUO-YYYY-NNNNNN` from `nextNumber`, with the settings prefix if set. Gapless, like invoices. |
| Quotation date | Today. Not backdated. |
| Valid until | Defaults to quotation date + 14 days; editable per quotation; must be on or after the quotation date. |
| Customer | Any active customer. Their tier prices apply. |
| Quote-for name / phone | Optional free text, only when the customer is the walk-in. Printed as the "Quotation for" name. |
| Payment type | Cash or credit; the walk-in is cash only (same rule as invoices). Carried into the invoice editor on conversion. |
| Lines | Part, description (snapshot), qty (whole units, > 0), quoted unit price (snapshot), line discount, line total. |
| Invoice discount | Amount or percent, like invoices. |
| Totals | Subtotal, invoice discount, VAT (rate snapshotted from settings), total — computed with the existing `computeTotals`. |
| Note | Optional free text, printed. Max 500 characters. |

**Statuses**

| Status | Stored? | Meaning | Allowed |
| --- | --- | --- | --- |
| Open | yes (`open`) | Valid until today or later. | Edit, convert, cancel, print. |
| Expired | no — `open` and `valid_until < today` | Prices no longer held. | Edit (a new valid-until revives it), convert at today's prices, cancel, print. |
| Converted | yes (`converted`) | Linked to the invoice it became. | Print, view. Read-only. |
| Cancelled | yes (`cancelled`) | Cancelled with a reason; number kept. | Print, view. Read-only. |

**Rules when saving a quotation**
- Prices come from `resolvePrices` for the customer's tier at save time; the browser never sends prices.
- The staff discount cap (`assertDiscountAllowed`) applies, so staff can't promise a discount they couldn't give on an invoice.
- Inactive parts can't be quoted. Out-of-stock parts can — stock on hand is shown in the editor for information only.
- Editing an open or expired quotation re-prices every line at today's prices for its (possibly changed) customer, keeps the number and records who edited it and when.

## 3. Converting to an invoice

1. **Convert to invoice** (on the quotation page, for Open and Expired) opens `/invoices/new?quotation=<id>`. The editor is pre-filled with the quotation's customer, payment type, lines and discounts, and shows "From quotation QUO-…".
2. Staff can remove lines, change quantities, add parts or switch the customer, then issue as usual. All existing checks run.
3. **Prices**
   - Quotation still valid (`valid_until >= today`): every part that is on the quotation uses its quoted unit price, whatever the qty and even if the customer was switched.
   - Parts added during conversion: today's price for the invoice's customer.
   - Quotation expired: today's prices for every line. The editor shows a notice listing each line whose price changed (old → new).
   - If the same part appears on two quotation lines, they share one unit price (one tier at save time), so a part → price map is enough.
4. **Server side.** `invoiceInputSchema` gains `quotationId?: uuid`. The browser only sends the id; quoted prices are read from `quotation_items` on the server.
   - `previewInvoice` uses the same price rule so on-screen totals match what is issued.
   - `createInvoice`, inside its transaction: lock the quotation row (`for update`) → it must be `open`, otherwise `InvalidState("QUO-… was already converted to INV-…")` / `("QUO-… is cancelled")` → resolve prices (quoted where valid, else current) → issue as today → set the quotation to `converted` with `invoice_id`, `converted_by`, `converted_at`.
   - Two people converting the same quotation at once: the row lock makes the second one fail with the "already converted" message.
5. **Drafts.** The invoice editor's auto-saved draft keeps `quotationId` in its data, so a half-finished conversion reopened later still uses the quotation's price rule. `getInvoiceDraftForEditor` uses that rule for the prices it shows.
6. **Cancelling the invoice.** `cancelInvoice` sets a linked `converted` quotation back to `open` and clears `invoice_id` / `converted_by` / `converted_at` in the same transaction, so it can be converted again. Its valid-until date is unchanged, so an expired quotation reopens as Expired. The cancelled invoice then no longer shows "From quotation" — the link lives on the quotation.

## 4. Screens

**Sidebar.** "Quotations" directly under "Invoices", for all users.

**List — `/quotations`.** Columns: number, date, customer (or the quote-for name, with "walk-in" muted), total, valid until, status badge (Open / Expired / Converted → INV-… / Cancelled). Filter by status; search by number, customer name or phone (quote-for phone included). Newest first, capped list like the invoices page. A "New quotation" button.

**Editor — `/quotations/new`, `/quotations/[id]/edit`.** A new `QuotationEditor`, separate from the 448-line `InvoiceEditor` (whose cash-received, payment-method, credit-override and draft logic don't apply). It reuses `CustomerPicker`, the part picker / line grid, `DiscountInput` and `TotalsPanel`, and shows a live preview of totals through a quotation preview action. Extra fields: valid until, quote-for name and phone (walk-in only), note. Buttons: **Save**, **Save, print A4**, **Save, download PDF**. No auto-saved draft — the quotation is the saved document. `/quotations/new?customerId=…` pre-selects a customer.

**Detail — `/quotations/[id]`.** Header with number, status, dates, customer; lines and totals; note. Actions: **Edit** (Open/Expired), **Convert to invoice** (Open/Expired), **Print**, **PDF**, **Cancel** (Open/Expired; asks for a reason, max 300 characters). A converted quotation links to its invoice; a cancelled one shows the reason, who and when.

**Invoice detail.** An invoice made from a quotation shows "From quotation QUO-…" linking back.

## 5. Print and PDF

- Reuse the A4 (`invoice-a4.tsx`) and PDF (`invoice-pdf.tsx`) templates by widening `InvoicePrintData` with a document kind: title **QUOTATION**, "Valid until" where the due date goes, no payment-type/due-date line, no amount in words, and a foot line "Prices valid until <date>. Subject to stock availability." plus the note. The customer block uses the quote-for name/phone for walk-in quotations.
- Print page `src/app/print/quotation/[id]` (A4 only; no thermal — quotations are sent, not handed over at the counter). Document title = the quotation number, so the browser's PDF file name matches.
- PDF route `/api/quotations/[id]/pdf`, mirroring the invoice PDF route.
- A cancelled quotation prints with a "CANCELLED" mark like cancelled invoices.

## 6. Data — migration `0009_quotations`

- `doc_type` enum: add `QUO`; `DocType` in `sequences.ts` gains `"QUO"`.
- New enum `quotation_status`: `open`, `converted`, `cancelled`.
- `quotations`: `id` uuid pk, `number` text unique, `customer_id` → customers, `quote_for_name` text null, `quote_for_phone` text null, `quotation_date` date, `valid_until` date, `payment_type`, `tier_id` → price_tiers, `vat_rate` numeric(5,2), `subtotal` / `discount_total` / `vat_amount` / `total` money, `invoice_discount_type` / `invoice_discount_value` (the discount as entered, so the editor can show it again), `note` text null, `status` default `open`, `cancel_reason`, `cancelled_by`, `cancelled_at`, `invoice_id` → invoices null, `converted_by`, `converted_at`, `updated_by`, `updated_at`, plus `audit()` (`created_by`, `created_at`).
- `quotation_items`: `id` uuid pk, `quotation_id` → quotations (on delete cascade — items are rewritten on edit), `line_no`, `part_id` → parts, `description`, `qty` int, `unit_price` money, `discount_type` / `discount_value` (as entered), `discount` money (computed), `line_total` money. Unique (`quotation_id`, `line_no`).
- Checks: `qty > 0`; `valid_until >= quotation_date`; `status = 'converted'` ⇔ `invoice_id is not null`; `status = 'cancelled'` ⇒ `cancel_reason is not null`.
- Indexes: `quotations (quotation_date)`, `quotations (status, valid_until)`, `quotations (invoice_id)`, `quotation_items (quotation_id)`.
- Row-level security on with no policies, like every other app table.
- `invoice_drafts.data` is jsonb, so carrying `quotationId` needs no schema change.

**Rollout.** The one Supabase project serves preview and production. Apply `0009` there via MCP with its drizzle tracking row (sha256 of the file with LF endings, `created_at` = journal `when`) **before** merging the code that uses it.

## 7. Architecture

- `src/server/services/quotations.ts` — `quotationInputSchema`, `previewQuotation`, `createQuotation`, `updateQuotation`, `cancelQuotation`, `getQuotation`, `listQuotations`, `getQuotationPrintData`, and `invoicePricesFromQuotation(tx, quotationId, today)` returning `{ quotation, prices: Map<partId, price> | null }` (null when expired) for invoicing to use.
- `src/server/actions/quotations.ts` — thin `runAction` wrappers with `revalidatePath("/quotations")`.
- `src/server/services/invoicing.ts` — `quotationId` in the input schema; the price rule in `previewInvoice` and `createInvoice`; mark converted; `cancelInvoice` reopens. `getInvoice` returns the linked quotation number for the invoice page.
- `src/server/services/invoice-drafts.ts` — keeps `quotationId`; `getInvoiceDraftForEditor` uses the price rule.
- Pages: `src/app/(app)/quotations/{page,new/page,[id]/page,[id]/edit/page}.tsx`; `src/app/(app)/invoices/new/page.tsx` reads `?quotation=`; `src/app/print/quotation/[id]/page.tsx`; `src/app/api/quotations/[id]/pdf/route.tsx`.
- Components: `src/components/billing/quotation-editor.tsx`, `src/components/billing/cancel-quotation-dialog.tsx`; print templates widened.
- Sidebar entry in `src/components/nav/sidebar.tsx`.

## 8. Errors

- Saving: no lines, inactive part, inactive customer, credit for the walk-in, discount over the staff cap, valid-until before the quotation date → the existing field-level/`InvalidState` messages.
- Editing or cancelling a converted/cancelled quotation → `InvalidState("QUO-… is converted/cancelled and can't be changed")`.
- Converting a converted/cancelled quotation → `InvalidState` naming the invoice it became, or that it was cancelled.
- Conversion failures (stock, credit limit) leave the quotation Open — the whole transaction rolls back, including the invoice number.

## 9. Testing (written before the code)

**Service tests** (Vitest against the test database):
- Numbering: `QUO-YYYY-000001`, then `000002`; prefix applied.
- Totals and VAT match `computeTotals`; quoted prices come from the customer's tier.
- Staff discount cap enforced on save; admin can exceed it.
- Walk-in: quote-for name/phone saved; credit refused.
- Edit allowed when open or expired (re-prices); refused when converted or cancelled.
- Cancel: reason required; cancelled can't be edited or converted.
- Convert while valid: invoice uses quoted prices when today's price differs; changed qty keeps the quoted price; switched customer keeps quoted prices; an added part gets today's price.
- Convert after expiry: today's prices on every line.
- Convert twice: second refused, naming the first invoice. Failed conversion (insufficient stock) leaves the quotation open.
- Cancelling the invoice reopens the quotation; it can be converted again.
- A quotation changes no stock, balance, payment or sales figure.
- Draft with `quotationId` previews and reopens with quoted prices.

**E2E** (Playwright): create a quotation → open its print page → convert → change a qty → issue → quotation shows Converted linking to the invoice, and the invoice shows "From quotation".

## 10. Out of scope

- Converting part of a quotation into several invoices.
- Copying ("duplicate") a quotation.
- Sending SMS or WhatsApp from the app (staff send the PDF themselves).
- Quotation figures on the dashboard (conversion rate, open quote value).
- Thermal print for quotations.
- A settings field for the default validity (14 days is fixed in code).
