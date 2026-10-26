# Quotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numbered quotations (`QUO-2026-000001`) that staff create, edit, print, download as PDF, cancel, and convert into an invoice that keeps the quoted prices while the quotation is valid.

**Architecture:** New `quotations` / `quotation_items` tables and a `src/server/services/quotations.ts` service that reuses the pricing helpers (`resolvePrices`, `computeTotals`, `assertDiscountAllowed`) and `nextNumber`. Conversion goes through the existing invoice editor and `createInvoice`, which gain an optional `quotationId`: the server reads quoted prices from `quotation_items`, and marks the quotation converted in the same transaction. Print reuses the A4 and PDF invoice templates with a widened data type.

**Tech Stack:** Next.js 15 (server components + server actions), Drizzle ORM on Supabase Postgres, zod 4, decimal.js via `@/lib/money`, `@react-pdf/renderer`, Vitest (service tests on the local test DB), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-26-quotations-design.md` — read it first; §3 (converting) and §6 (data) are the parts tasks argue from.

## Global Constraints

- Everyone signed in (admin and staff) can create, edit, convert and cancel quotations (`requireUser`). No admin-only parts.
- Business dates are Colombo dates: `colomboDate()`, `addDays()` from `@/lib/dates`. Money is 2-decimal strings; maths via `@/lib/money` (`D`, `fmt`); display `Rs ` + `formatMoney`.
- Number format `QUO-YYYY-NNNNNN` via `nextNumber(tx, "QUO")`, prefixed with the settings `docPrefix` when set.
- Default validity: `QUOTE_VALID_DAYS = 14` days after the quotation date. `validUntil` must be on or after the quotation date.
- Limits: note ≤ 500 characters; cancel reason 1–300 characters; quote-for name ≤ 120, phone ≤ 40.
- Quote-for name/phone are kept only when the customer is the walk-in; for any other customer they are saved as null.
- A quotation never writes `stock_movements`, `payments`, `payment_allocations` or `invoices` (except the conversion, which goes through `createInvoice`).
- Copy: statuses `Open`, `Expired`, `Converted`, `Cancelled`; print title `QUOTATION`; print foot `Prices valid until <d MMM yyyy>. Subject to stock availability.`; invoice detail `From quotation QUO-…`; editor banner `From quotation QUO-…`; expired banner `QUO-… expired on <date>. Today's prices are used:` followed by `SKU: Rs old → Rs new` per changed line; errors `QUO-… was already converted to INV-…`, `QUO-… is cancelled`, `QUO-… is converted and can't be changed`, `QUO-… is cancelled and can't be changed`, `Valid until can't be before the quotation date`.
- **Payment type on conversion is NOT preselected.** The invoice editor deliberately has no default ("a preselected Cash let invoices be saved as paid when no money was taken", `invoice-editor.tsx:63`). The quotation's payment type is only shown as a hint (`Quoted as cash` / `Quoted as credit`). This narrows spec §3.1, which says the payment type is pre-filled.
- Migrations: the one Supabase project (`iuwjtvyyghefjkbiqiiq`) serves preview and production. `0009_quotations` must be applied there (via MCP + drizzle tracking row) **before** the code that uses it is merged — and only after the user says go (Task 8).

## Review Focus

1. **A quoted part whose price was deleted or changed after quoting** — converting while valid still uses the quoted price and doesn't raise `PriceMissing`; only parts *not* on the quotation are looked up. Test in Task 3 (`keeps the quoted price even when the part no longer has a price`).
2. **The same part on two quotation lines with different discounts** — both lines convert at the one quoted unit price; the invoice keeps two lines. Test in Task 3 (`prices a part on two lines from one quoted price`).
3. **Expired by exactly one day vs. valid until today** — `validUntil === today` is still Open and keeps quoted prices; `validUntil === yesterday` is Expired. Test in Task 2 (`quotationStatus` boundaries) and Task 3 (`converts on the last valid day at quoted prices`).
4. **Switching the customer in the invoice editor to a walk-in, with a credit quotation** — the walk-in rule still refuses credit; the quoted prices still apply for cash. Test in Task 3 (`a switched customer keeps quoted prices`, cash).
5. **Reopening a half-finished conversion from Unfinished invoices after the quotation was converted by someone else** — the draft reopens, and saving fails with `QUO-… was already converted to INV-…` instead of a second conversion. Test in Task 3 (`a draft of a converted quotation can't issue a second invoice`).

---

### Task 1: Schema, migration and the QUO number

**Files:**
- Modify: `src/server/db/schema/reference.ts` (enums), `src/server/db/schema/documents.ts` (tables, `InvoiceDraftData`), `src/server/services/sequences.ts:6` (`DocType`)
- Create: `drizzle/0009_quotations.sql` (+ `drizzle/meta/0009_snapshot.json`, journal entry — both from `drizzle-kit generate`)
- Test: `tests/services/schema.test.ts`, `tests/services/sequences.test.ts`

**Interfaces:**
- Produces (Drizzle exports from `@/server/db/schema`):
  - `docTypeEnum` values `["INV", "GRN", "CRN", "PAY", "ADJ", "QUO"]`; `DocType` gains `"QUO"`.
  - `quotationStatusEnum = pgEnum("quotation_status", ["open", "converted", "cancelled"])` in `reference.ts`.
  - `quotations` table, columns (TS name → SQL name): `id` uuid pk defaultRandom; `number` text not null unique; `customerId` → customers not null; `quoteForName`, `quoteForPhone` text null; `quotationDate` date(string) not null; `validUntil` date(string) not null; `paymentType` not null; `tierId` → price_tiers not null; `vatRate` numeric(5,2) not null; `subtotal`, `discountTotal`, `vatAmount`, `total` money not null; `invoiceDiscountType` text null, `invoiceDiscountValue` numeric(12,2) string null; `note` text null; `status` default `open` not null; `cancelReason` text null, `cancelledBy` → profiles null, `cancelledAt` timestamptz null; `invoiceId` → invoices null; `convertedBy` → profiles null, `convertedAt` timestamptz null; `updatedBy` → profiles not null; `updatedAt` timestamptz default now not null; `...audit()`.
  - Checks: `quotations_valid_after_date` (`valid_until >= quotation_date`), `quotations_converted_has_invoice` (`(status = 'converted') = (invoice_id is not null)`), `quotations_cancelled_has_reason` (`status <> 'cancelled' or cancel_reason is not null`), `quotations_discount_pair` (`(invoice_discount_type is null) = (invoice_discount_value is null)` and type in `('amount','percent')` when set). Indexes: `quotations_date_idx (quotation_date)`, `quotations_status_valid_idx (status, valid_until)`, unique `quotations_invoice_idx (invoice_id) where invoice_id is not null`.
  - `quotationItems` table: `id` uuid pk; `quotationId` → quotations not null **on delete cascade**; `lineNo` int; `partId` → parts; `description` text; `qty` int; `unitPrice` money; `discountType` text null, `discountValue` numeric(12,2) null; `discount` money; `lineTotal` money. Checks `quotation_items_qty_positive` (`qty > 0`), `quotation_items_price_non_negative`, `quotation_items_discount_pair` (as above). Unique `(quotation_id, line_no)`; index `quotation_items_quotation_idx`.
  - `InvoiceDraftData` gains `quotationId?: string`.

- [ ] **Step 1: Write the failing schema tests** in `tests/services/schema.test.ts` (new `describe("quotations")`; insert a quotation row directly with a factory admin, the walk-in customer and the Retail tier):
  - `rejects a quotation item with qty 0` → `pgErrorCode(...)` is `"23514"`.
  - `rejects valid_until before quotation_date` → `"23514"`.
  - `rejects converted without an invoice` (set `status: "converted"`, `invoiceId: null`) → `"23514"`.
  - `rejects cancelled without a reason` → `"23514"`.
  - `deletes items with their quotation` → after `db.delete(quotations)`, `db.$count(quotationItems)` is `0`.
- [ ] **Step 2: Write the failing sequence test** in `tests/services/sequences.test.ts`: `issues QUO numbers` → `nextNumber(tx, "QUO", IN_2026)` twice gives `"QUO-2026-000001"`, `"QUO-2026-000002"`.
- [ ] **Step 3: Run** `pnpm test tests/services/schema.test.ts tests/services/sequences.test.ts` — Expected: FAIL (no `quotations` export / type error on `"QUO"`).
- [ ] **Step 4: Add the enums, tables and `DocType`**. Put `quotations` and `quotationItems` in `documents.ts` after `invoiceItems`, with a doc comment like the other tables ("Priced offers to a customer. They never touch stock or balances; converting one issues an invoice through createInvoice.").
- [ ] **Step 5: Generate the migration**: `pnpm db:generate --name quotations`. Check `drizzle/0009_quotations.sql` has `ALTER TYPE "public"."doc_type" ADD VALUE 'QUO';`, the new enum, both tables, the cascade FK and all checks. Append by hand, matching `0004`:
  ```sql
  --> statement-breakpoint
  -- RLS on with no policies, like every other app table (see 0001): the browser roles never read it.
  ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
  ALTER TABLE "quotation_items" ENABLE ROW LEVEL SECURITY;
  ```
- [ ] **Step 6: Run** the same tests — Expected: PASS (global setup migrates the test DB). Then `pnpm typecheck` — Expected: no errors.
- [ ] **Step 7: Commit**
  ```bash
  git add src/server/db/schema src/server/services/sequences.ts drizzle tests/services/schema.test.ts tests/services/sequences.test.ts
  git commit -m "feat(quotations): quotations tables and QUO numbers"
  ```

---

### Task 2: Quotation service — save, edit, cancel, read, list

**Files:**
- Create: `src/lib/quotations.ts`, `src/server/services/quotations.ts`
- Modify: `src/lib/validation.ts` (move the discount and sale-line schemas here), `src/server/services/invoicing.ts:39-61` (import them instead of defining them)
- Test: `tests/lib/quotations.test.ts`, `tests/services/quotations.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; `resolvePrices`, `lookupPrices`, `computeTotals`, `assertDiscountAllowed`, `Totals` from `@/server/services/pricing`; `nextNumber`; `getSettings`; `getCustomer`, `CustomerRow` from `@/server/services/customers`; type `EditorDraft` from `@/server/services/invoice-drafts` (type-only import).
- Produces:
  ```ts
  // src/lib/validation.ts (moved from invoicing.ts, unchanged rules and messages)
  export const discountSchema;   // optional { type: "amount" | "percent"; value: string }
  export const saleLinesSchema;  // array of { partId, qty, discount }, min 1, "Add at least one part"

  // src/lib/quotations.ts (pure; safe in client components)
  export const QUOTE_VALID_DAYS = 14;
  export type QuotationStatus = "open" | "expired" | "converted" | "cancelled";
  export function quotationStatus(stored: "open" | "converted" | "cancelled", validUntil: string, today: string): QuotationStatus;
  export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string>; // "Open", "Expired", "Converted", "Cancelled"

  // src/server/services/quotations.ts
  export const quotationInputSchema; // customerId, paymentType, validUntil? (YYYY-MM-DD), quoteForName?, quoteForPhone?, note?, lines: saleLinesSchema, invoiceDiscount: discountSchema
  export type QuotationInput = z.input<typeof quotationInputSchema>;
  export function previewQuotation(user: SessionUser, input: QuotationInput): Promise<Totals & { prices: Record<string, string>; stock: Record<string, number> }>;
  export function createQuotation(user: SessionUser, input: QuotationInput): Promise<{ id: string; number: string }>;
  export function updateQuotation(user: SessionUser, id: string, input: QuotationInput): Promise<void>;
  export function cancelQuotation(user: SessionUser, id: string, reason: string): Promise<void>;
  export type QuotationDetail = {
    id: string; number: string; quotationDate: string; validUntil: string;
    status: QuotationStatus; paymentType: "cash" | "credit"; tierName: string; vatRate: string;
    subtotal: string; discountTotal: string; vatAmount: string; total: string;
    note: string | null; quoteForName: string | null; quoteForPhone: string | null;
    cancelReason: string | null; cancelledAt: Date | null; cancelledByName: string | null;
    invoice: { id: string; number: string } | null; convertedAt: Date | null;
    createdAt: Date; createdByName: string; updatedAt: Date; updatedByName: string;
    customer: InvoiceDetail["customer"];
    items: { id: string; lineNo: number; partId: string; sku: string; description: string; qty: number; unitPrice: string; discount: string; lineTotal: string }[];
  };
  export function getQuotation(id: string): Promise<QuotationDetail>; // NotFound("Quotation not found") for bad/unknown id
  export type QuotationListRow = { id: string; number: string; quotationDate: string; validUntil: string; customerName: string; quoteForName: string | null; isWalkIn: boolean; total: string; status: QuotationStatus; invoiceNumber: string | null };
  export function listQuotations(filters?: { q?: string; status?: QuotationStatus; limit?: number }): Promise<QuotationListRow[]>;
  export type QuotationEditorData = Omit<EditorDraft, "id" | "cashPayment"> & { id: string; number: string; validUntil: string; quoteForName: string | null; quoteForPhone: string | null; note: string | null };
  export function getQuotationForEditor(id: string): Promise<QuotationEditorData | null>; // null when unknown, converted or cancelled
  ```

- [ ] **Step 1: Write the failing lib test** `tests/lib/quotations.test.ts`:
  - `quotationStatus("open", "2026-10-26", "2026-10-26")` → `"open"`; `("open", "2026-10-25", "2026-10-26")` → `"expired"`; `("converted", "2026-01-01", "2026-10-26")` → `"converted"`; `("cancelled", …)` → `"cancelled"`.
- [ ] **Step 2: Write the failing service tests** `tests/services/quotations.test.ts` (`resetDb` in `beforeEach`; `staff = makeUser("staff")`, `admin = makeUser("admin")`; `makePart({ qty: 2 })` is Retail 1000.00 / Dealer 900.00):
  - `numbers a quotation and prices it from the customer's tier`: Dealer customer, 2 × part → `number` matches `/^QUO-\d{4}-000001$/`; `getQuotation` → `subtotal "1800.00"`, `total "1800.00"`, `status "open"`, `validUntil === addDays(colomboDate(), 14)`, item `unitPrice "900.00"`.
  - `adds VAT when VAT is on`: `settings.vatEnabled = true, vatRate "18.00"`; 1 × Retail → `vatAmount "180.00"`, `total "1180.00"`, `vatRate "18.00"`.
  - `keeps the discount as typed`: line discount `{ type: "percent", value: "10" }`, invoice discount `{ type: "amount", value: "50" }` → item `discount "100.00"`; `getQuotationForEditor` returns `lines[0].discount` `{ type: "percent", value: "10.00" }` and `invoiceDiscount` `{ type: "amount", value: "50.00" }`.
  - `caps staff discounts but not admin`: staff with 50% line discount → rejects `DiscountNotAllowed`; admin same input → resolves.
  - `quotes out-of-stock parts but not inactive ones`: qty 0 part, qty 5 → resolves; `isActive: false` part → rejects `InvalidState`.
  - `keeps the quote-for name only for the walk-in`: walk-in with `quoteForName: "Nimal"`, `quoteForPhone: "0771234567"` → saved; Dealer customer with the same → both null.
  - `refuses credit for the walk-in and an inactive customer`: both reject `InvalidState`.
  - `refuses valid until before today`: `validUntil: addDays(colomboDate(), -1)` → rejects `InvalidState("Valid until can't be before the quotation date")`.
  - `edits an open or expired quotation and re-prices it`: create at Retail; change the part's Retail price to `1100.00`; set the row expired (`quotationDate`/`validUntil` both 30 days back via `db.update`); `updateQuotation(other, id, { …, validUntil: addDays(today, 14) })` (`other = makeUser("staff")`) → same `number`, `unitPrice "1100.00"`, `status "open"`, `updatedByName` is `other`'s name.
  - `refuses to edit or cancel a cancelled quotation`: `cancelQuotation(staff, id, "Customer bought elsewhere")` → `status "cancelled"`, `cancelReason` saved; then `updateQuotation` rejects `InvalidState(/is cancelled and can't be changed/)`; `cancelQuotation` again rejects `InvalidState`. Empty reason rejects (zod).
  - `never touches stock, payments or invoices`: after create + update + cancel, `db.$count(stockMovements)` equals the count before, `db.$count(payments)` and `db.$count(invoices)` are 0, and `parts.qtyOnHand` unchanged.
  - `lists newest first, searches and filters by status`: three quotations (one walk-in with `quoteForName: "Nimal"`, one cancelled, one set expired) → `listQuotations({ q: "Nimal" })` returns only the walk-in one; `{ status: "expired" }` only the expired one; `{ status: "open" }` excludes expired and cancelled.
- [ ] **Step 3: Run** `pnpm test tests/lib/quotations.test.ts tests/services/quotations.test.ts` — Expected: FAIL (modules missing).
- [ ] **Step 4: Move `discountSchema` and the lines array schema** from `invoicing.ts` into `src/lib/validation.ts` as `discountSchema` / `saleLinesSchema`; `invoiceInputSchema` uses them. `pnpm test tests/services/invoicing.test.ts` still passes.
- [ ] **Step 5: Implement `src/lib/quotations.ts`** and **`src/server/services/quotations.ts`**.
  - `createQuotation` / `updateQuotation` share one private `priceQuotation(tx, user, data)` that: locks the customer row like `createInvoice` step 1, checks active / walk-in credit, checks parts active (`lockParts` is not needed — use a plain select), runs `resolvePrices` → `computeTotals` → `assertDiscountAllowed` (settings `staffMaxDiscountPct`, VAT rate `settings.vatEnabled ? settings.vatRate : "0.00"`), and returns the row values + item values. Discounts are stored normalised with `fmt(D(value))`.
  - `updateQuotation` locks the quotation (`for update`), refuses `converted`/`cancelled`, keeps `number`, `quotationDate`, `createdBy`; `validUntil` defaults to the existing one when omitted; deletes and re-inserts items; sets `updatedBy`, `updatedAt = now()`.
  - `listQuotations` search: `ilike` over number, customer name, business name, phone, `quote_for_name`, `quote_for_phone` (use `escapeLike`). Status filter in SQL: `expired` = `status = 'open' and valid_until < today`; `open` = `status = 'open' and valid_until >= today`. Order `quotation_date desc, number desc`, `limit 200`.
  - `getQuotationForEditor` returns parts with today's `qtyOnHand` and today's `lookupPrices` (for display only — the preview re-prices).
- [ ] **Step 6: Run** the tests from Step 3 plus `pnpm test tests/services/invoicing.test.ts` — Expected: PASS.
- [ ] **Step 7: Commit**
  ```bash
  git add src/lib src/server/services/quotations.ts src/server/services/invoicing.ts tests/lib/quotations.test.ts tests/services/quotations.test.ts
  git commit -m "feat(quotations): quotation service"
  ```

---

### Task 3: Converting — quoted prices in invoicing, drafts and cancel

**Files:**
- Modify: `src/server/services/quotations.ts` (add two functions), `src/server/services/invoicing.ts` (schema, `createInvoice`, `previewInvoice`, `cancelInvoice`, `getInvoice`), `src/server/services/invoice-drafts.ts` (`EditorDraft`, `getInvoiceDraftForEditor`)
- Test: `tests/services/quotation-conversion.test.ts`

**Interfaces:**
- Consumes: Task 2 (`createQuotation`, `getQuotation`, `quotationStatus`).
- Produces:
  ```ts
  // quotations.ts
  export type QuotationPrices = {
    id: string; number: string; status: "open" | "converted" | "cancelled"; invoiceNumber: string | null;
    expired: boolean; validUntil: string;
    prices: Map<string, string>; // partId → quoted unit price
  };
  export function loadQuotationPrices(tx: Executor, id: string, opts?: { lock?: boolean }): Promise<QuotationPrices>; // NotFound when missing
  export type QuotationLink = { id: string; number: string; expired: boolean; validUntil: string; paymentType: "cash" | "credit";
    priceChanges: { sku: string; quoted: string; current: string }[] }; // only when expired and different
  export function getQuotationForInvoice(id: string): Promise<(Omit<EditorDraft, "id" | "cashPayment"> & { quotation: QuotationLink }) | null>; // null unless open (valid or expired)

  // invoicing.ts
  invoiceInputSchema gains quotationId: z.uuid().optional()
  InvoiceDetail gains quotation: { id: string; number: string } | null

  // invoice-drafts.ts
  EditorDraft gains quotation?: QuotationLink
  ```

- [ ] **Step 1: Write the failing tests** `tests/services/quotation-conversion.test.ts` (Retail customer, `makePart({ qty: 10 })` unless stated; helper `expire(id)` sets `quotationDate` and `validUntil` to 30 and 16 days ago):
  - `converts at the quoted price while valid`: quote 2 × part (Retail 1000.00); change Retail price to `1200.00`; `createInvoice(staff, { customerId, paymentType: "cash", lines: [{ partId, qty: 2 }], quotationId })` → invoice item `unitPrice "1000.00"`, total `"2000.00"`; `getQuotation` → `status "converted"`, `invoice.number` equals the invoice number.
  - `keeps the quoted price for a changed qty and prices an added part today`: quote 2 × A; convert with 5 × A and 1 × B (new part) → A `unitPrice` is the quoted price, B is today's Retail `1000.00`.
  - `keeps the quoted price even when the part no longer has a price`: quote A; delete A's `part_prices` rows; convert → succeeds at the quoted price (no `PriceMissing`).
  - `prices a part on two lines from one quoted price`: quote A on two lines (second with 10% discount); convert both lines → both `unitPrice` equal the quoted price, 2 invoice items.
  - `a switched customer keeps quoted prices`: quote at Retail for customer X (cash); convert with the walk-in customer and cash → quoted Retail price; with walk-in + credit → rejects `InvalidState` (existing rule).
  - `converts on the last valid day at quoted prices`: set `validUntil = colomboDate()` → quoted price used.
  - `uses today's prices after expiry`: quote, `expire(id)`, change price to `1200.00`, convert → `unitPrice "1200.00"`, quotation `converted`. `getQuotationForInvoice(id)` before converting → `quotation.expired true`, `priceChanges [{ sku, quoted: "1000.00", current: "1200.00" }]`.
  - `refuses a second conversion and keeps the first`: convert once; second `createInvoice` with the same `quotationId` rejects `InvalidState(/was already converted to INV-/)`; `db.$count(invoices)` is 1.
  - `refuses converting a cancelled quotation`: rejects `InvalidState(/is cancelled/)`.
  - `a failed conversion leaves the quotation open`: part with qty 1, quote 3; convert 3 → rejects `InsufficientStock`; `getQuotation` → `status "open"`, `invoice null`.
  - `previews with quoted prices`: `previewInvoice(staff, { …, quotationId })` → `prices[partId]` is the quoted price.
  - `cancelling the invoice reopens the quotation`: convert, `cancelInvoice(admin, invoiceId, "Wrong customer")` → quotation `status "open"`, `invoice null`; converting again succeeds.
  - `shows the quotation on the invoice`: after converting, `getInvoice(staff, invoiceId).quotation` → `{ id, number }`; plain invoice → `null`.
  - `a draft keeps the quotation and its prices`: `previewAndSaveDraft(staff, { …, quotationId }, draftId)`; change Retail price; `getInvoiceDraftForEditor(draftId)` → `quotation.number` set, `lines[0].part.price` is the quoted price.
  - `a draft of a converted quotation can't issue a second invoice`: save a draft with `quotationId`; convert the quotation through another `createInvoice`; issuing the draft input (`draftId` + `quotationId`) rejects `InvalidState(/was already converted/)`.
- [ ] **Step 2: Run** `pnpm test tests/services/quotation-conversion.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `loadQuotationPrices`, `getQuotationForInvoice`** in `quotations.ts`. `getQuotationForInvoice` uses quoted prices when valid and `lookupPrices` for the quotation customer's tier when expired; `priceChanges` lists only lines whose price differs.
- [ ] **Step 4: Wire the price rule into `invoicing.ts`.** One private helper used by both `createInvoice` (step 3–5) and `previewInvoice`:
  ```ts
  /** Quoted prices for parts on a still-valid quotation; today's prices for everything else. */
  async function invoicePrices(tx: Executor, tierId: string, partIds: string[], quote: QuotationPrices | null): Promise<Map<string, string>>
  ```
  Only parts not covered by `quote.prices` (or all parts when `quote` is null or expired) go to `resolvePrices`. In `createInvoice`, load the quotation with `{ lock: true }` right after the customer lock; if `status !== "open"` throw the copy from Global Constraints (`was already converted to ${invoiceNumber}` / `is cancelled`). After the invoice insert (step 12, next to the draft delete) set `status: "converted", invoiceId, convertedBy: user.id, convertedAt: new Date()`. `previewInvoice` loads without the lock and throws the same errors.
- [ ] **Step 5: `cancelInvoice`**: in the same transaction, after the invoice update, `update quotations set status = 'open', invoice_id = null, converted_by = null, converted_at = null where invoice_id = <invoiceId>`. **`getInvoice`**: left join `quotations` on `quotations.invoiceId = invoices.id`, return `quotation: { id, number } | null`.
- [ ] **Step 6: Drafts**: `getInvoiceDraftForEditor` — when `draft.data.quotationId` is set, call `getQuotationForInvoice(quotationId)`. Non-null: set `EditorDraft.quotation` to its `.quotation`, and when not expired take each draft line's `part.price` from the quotation lines with the same `partId` (parts the quotation doesn't have keep `lookupPrices`). Null (missing, converted or cancelled): `quotation` stays undefined and today's prices are shown; issuing then fails with the clear message because `quotationId` is still in the draft data.
- [ ] **Step 7: Run** `pnpm test tests/services` — Expected: PASS (existing invoicing, cancel, draft and print tests included).
- [ ] **Step 8: Commit**
  ```bash
  git add src/server/services tests/services/quotation-conversion.test.ts
  git commit -m "feat(quotations): convert a quotation into an invoice at quoted prices"
  ```

---

### Task 4: Print page and PDF

**Files:**
- Modify: `src/server/services/print.ts` (widen `InvoicePrintData`, add `getQuotationPrintData`), `src/components/print/invoice-a4.tsx`, `src/components/print/invoice-pdf.tsx`
- Create: `src/app/print/quotation/[id]/page.tsx`, `src/app/api/quotations/[id]/pdf/route.tsx`
- Test: `tests/services/print.test.ts`

**Interfaces:**
- Consumes: `getQuotation` (Task 2).
- Produces:
  ```ts
  // InvoicePrintData changes (existing invoice fields unchanged)
  kind: "invoice" | "quotation";            // getInvoicePrintData sets "invoice"
  title: "TAX INVOICE" | "INVOICE" | "QUOTATION";
  validUntil: string | null;                // quotations only
  note: string | null;                      // quotations only
  // for quotations: status "cancelled" when cancelled, else "issued"; amountInWords ""; dueDate = validUntil
  export function getQuotationPrintData(id: string): Promise<InvoicePrintData>;
  ```
- [ ] **Step 1: Write the failing tests** in `tests/services/print.test.ts` (new `describe("getQuotationPrintData")`):
  - `prints a quotation`: walk-in quotation with `quoteForName: "Nimal Perera"`, `quoteForPhone: "0771234567"`, note `"Fits CD70"` → `kind "quotation"`, `title "QUOTATION"`, `customer.name "Nimal Perera"`, `customer.phone "0771234567"`, `validUntil` = the quotation's, `note "Fits CD70"`, `amountInWords ""`.
  - `marks a cancelled quotation`: → `status "cancelled"`.
  - `renders the quotation PDF`: `renderToBuffer(<InvoicePdf data={data} />)` → `buffer.length > 1000`.
  - Existing invoice tests: add `expect(data.kind).toBe("invoice")` to the first one.
- [ ] **Step 2: Run** `pnpm test tests/services/print.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `getQuotationPrintData`** and set the new fields in `getInvoicePrintData`. The title follows the quotation's own VAT snapshot only for invoices; quotations are always `QUOTATION`.
- [ ] **Step 4: Templates.** In both `InvoiceA4` and `InvoicePdf`, when `data.kind === "quotation"`: meta rows `No`, `Date`, `Valid until` (no `Due`, no `Payment`); customer label `Quotation for` instead of `Bill to`; no amount-in-words line; under the totals the foot line `Prices valid until <formatDate(validUntil)>. Subject to stock availability.` and the note when set; no "Received by" signature box. The `CANCELLED` watermark works as today.
- [ ] **Step 5: Print page and PDF route**, mirroring `src/app/print/invoice/[id]/page.tsx` and `src/app/api/invoices/[id]/pdf/route.tsx`: back link `/quotations/${id}`, one format (A4, `formats` with only `{ label: "A4", … }`), metadata title = number; the PDF route returns `Content-Disposition: attachment; filename=<number>.pdf` when `?download=1`, else `inline`, and `404 "Quotation not found"` on `NotFound`.
- [ ] **Step 6: Run** `pnpm test tests/services/print.test.ts` and `pnpm typecheck` — Expected: PASS / no errors.
- [ ] **Step 7: Commit**
  ```bash
  git add src/server/services/print.ts src/components/print src/app/print/quotation src/app/api/quotations tests/services/print.test.ts
  git commit -m "feat(quotations): A4 print and PDF"
  ```

---

### Task 5: Quotation editor and the new / edit pages

**Files:**
- Create: `src/server/actions/quotations.ts`, `src/components/billing/quotation-editor.tsx`, `src/app/(app)/quotations/new/page.tsx`, `src/app/(app)/quotations/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: Task 2 service functions, `QUOTE_VALID_DAYS`; `CustomerPicker`, `LineItemsGrid`, `DiscountInput`, `TotalsPanel` (unchanged).
- Produces (server actions, all `runAction` + `requireUser`, all `revalidatePath("/quotations")`):
  ```ts
  export async function previewQuotationAction(input: QuotationInput);
  export async function createQuotationAction(input: QuotationInput);          // → { id, number }
  export async function updateQuotationAction(id: string, input: QuotationInput); // also revalidatePath(`/quotations/${id}`)
  export async function cancelQuotationAction(id: string, reason: string);
  ```
  ```tsx
  export function QuotationEditor(props: {
    initialCustomer: PickedCustomer;
    quotation?: QuotationEditorData;   // edit mode when set
    partFilters: PartFilterOptions; isAdmin: boolean; vatRate: string; staffCapPct: string;
    today: string;                     // colomboDate() from the server, for the default valid-until
  }): JSX.Element;
  ```
- [ ] **Step 1: Server actions** in `src/server/actions/quotations.ts`, shaped like `src/server/actions/invoices.ts`.
- [ ] **Step 2: `QuotationEditor`.** Same layout as `InvoiceEditor` (`grid xl:grid-cols-[minmax(0,1fr)_22rem]`), same line state, validation helpers and 250 ms debounced preview — call `previewQuotationAction`. Differences: Cash/Credit toggle defaults to the quotation's (or `cash` for new) and credit is disabled for the walk-in; no cash received / paid-by / credit-override / draft logic; row error shows `Only N in stock` as a muted note, not an error (it doesn't block saving); fields `Valid until` (date input, default `addDays(today, QUOTE_VALID_DAYS)`, `min = today`), and when the customer is the walk-in, `Quote for (name)` and `Phone`; `Note` textarea (`maxLength 500`). Buttons `Save quotation` (submit, Ctrl+Enter), `Save, print A4` → `/print/quotation/${id}?autoprint=1`, `Save, download PDF` → push `/quotations/${id}` then click a temporary `<a href="/api/quotations/${id}/pdf?download=1" download>`. Toast `QUO-… saved`. On edit it calls `updateQuotationAction` and keeps the number.
- [ ] **Step 3: Pages.** `new/page.tsx` mirrors `invoices/new/page.tsx` (walk-in default, `?customerId=` preselect, settings, part filters), title `New quotation`. `[id]/edit/page.tsx` loads `getQuotationForEditor(id)`; `null` → `redirect(`/quotations/${id}`)`; title `Edit QUO-…`.
- [ ] **Step 4: Check it in the browser** with the `run` skill: create a walk-in quotation with a quote-for name, an out-of-stock part and a 5% line discount; save; edit it and change the qty; confirm the totals match the preview and the number is unchanged. `pnpm lint` and `pnpm typecheck` — Expected: clean.
- [ ] **Step 5: Commit**
  ```bash
  git add src/server/actions/quotations.ts src/components/billing/quotation-editor.tsx "src/app/(app)/quotations"
  git commit -m "feat(quotations): quotation editor"
  ```

---

### Task 6: Quotations list, detail page, cancel, sidebar

**Files:**
- Create: `src/app/(app)/quotations/page.tsx`, `src/app/(app)/quotations/[id]/page.tsx`, `src/components/billing/cancel-quotation-dialog.tsx`, `src/components/billing/quotation-status-badge.tsx`
- Modify: `src/components/nav/sidebar.tsx:35` (add `{ href: "/quotations", label: "Quotations", icon: FileSignature }` right after Invoices — use any lucide icon that exists in the installed version; check `node_modules/lucide-react`)

**Interfaces:**
- Consumes: `listQuotations`, `getQuotation`, `cancelQuotationAction`, `QUOTATION_STATUS_LABEL`.
- Produces: `QuotationStatusBadge({ status, invoiceNumber }: { status: QuotationStatus; invoiceNumber?: string | null })` — Open `secondary`, Expired `outline` (warning tone), Converted `default` with text `Converted → INV-…`, Cancelled `destructive`.
- [ ] **Step 1: List page** modelled on `src/app/(app)/invoices/page.tsx`: search `q` (placeholder `Quotation no, customer or phone`), status select (All / Open / Expired / Converted / Cancelled), Clear link, `New quotation` button. Columns: Number (link), Date, Customer (walk-in rows show `quoteForName` with a muted `walk-in`), Valid until, Total (right-aligned), Status badge. Empty text `No quotations yet.` / `No quotations match.` Unknown `status` params are ignored.
- [ ] **Step 2: Detail page** modelled on `src/app/(app)/invoices/[id]/page.tsx`: header number + badge, description `<date>, <customer or quote-for name>`; actions `Edit` (open/expired → `/quotations/${id}/edit`), `Convert to invoice` (open/expired → `/invoices/new?quotation=${id}`), `Print A4`, `PDF` (`/api/quotations/${id}/pdf`), `Cancel` (open/expired, dialog). Body: customer block (with quote-for name/phone), valid until, lines table, totals, note, created/updated by. Converted: line `Converted to <INV link> on <date>`. Cancelled: reason, who, when. `NotFound` → `notFound()`.
- [ ] **Step 3: `CancelQuotationDialog`** copied in shape from `cancel-invoice-dialog.tsx`, calling `cancelQuotationAction`; available to all users; text `Cancel QUO-…? The number is kept and it can't be converted.`
- [ ] **Step 4: Check it in the browser**: the list filters and search work, an expired one (set via SQL on the local DB) shows Expired, cancel hides Edit/Convert. `pnpm lint`, `pnpm typecheck` — clean.
- [ ] **Step 5: Commit**
  ```bash
  git add "src/app/(app)/quotations" src/components/billing src/components/nav/sidebar.tsx
  git commit -m "feat(quotations): quotations list, detail and cancel"
  ```

---

### Task 7: Convert from the invoice editor, invoice link, e2e

**Files:**
- Modify: `src/app/(app)/invoices/new/page.tsx` (read `?quotation=`), `src/components/billing/invoice-editor.tsx`, `src/app/(app)/invoices/[id]/page.tsx` (link back)
- Test: `e2e/quotations.spec.ts`

**Interfaces:**
- Consumes: `getQuotationForInvoice` / `QuotationLink` (Task 3), `EditorDraft.quotation` (Task 3).
- Produces: `InvoiceEditor` prop `draft` accepts `id?: string` (no id = prefilled but not yet a saved draft) and gains `quotation?: QuotationLink`.
- [ ] **Step 1: Write the failing e2e** `e2e/quotations.spec.ts` (runs after `full-flow` and `invoice-drafts`; BRK-001 has 3 in stock):
  ```ts
  test("a quotation is printed, converted and linked to its invoice", async ({ page }) => {
    // login admin → /quotations/new → add BRK-001, qty 3 → "Save quotation"
    // expect heading /QUO-\d{4}-\d{6}/ and text "Open"
    // "Print A4" → expect text "QUOTATION" and "Subject to stock availability" → go back
    // "Convert to invoice" → expect text /From quotation QUO-/ and Qty for BRK-001 = "3"
    // set qty 1, choose Cash, cash received 5000, "Save invoice"
    // expect invoice page text /From quotation QUO-/; click it → quotation shows /Converted → INV-/
    // and has no "Convert to invoice" button
  });
  ```
- [ ] **Step 2: Run** `pnpm test:e2e e2e/quotations.spec.ts` — Expected: FAIL (convert link leads to an editor without the quotation).
- [ ] **Step 3: `invoices/new/page.tsx`**: with `?quotation=<id>`, call `getQuotationForInvoice(id)`; `null` → `redirect(`/quotations/${id}`)`; otherwise use its customer (if inactive, fall back to the walk-in like today) and pass `draft={{ lines, invoiceDiscount }}` and `quotation`. Title `Invoice from QUO-…`. A reopened draft with `draft.quotation` passes that too.
- [ ] **Step 4: `InvoiceEditor`**: `draftId`/`draftSaved` start from `draft?.id` only; `buildInput` sends `quotationId: quotation?.id`; above the lines show the banner `From quotation QUO-…` linking to `/quotations/${id}`, with `Quoted as cash` / `Quoted as credit`, and — when `quotation.expired` and `priceChanges.length` — the expired notice from Global Constraints. Payment type stays unselected.
- [ ] **Step 5: Invoice detail**: when `inv.quotation`, show `From quotation <link>` under the header.
- [ ] **Step 6: Run** `pnpm test:e2e e2e/quotations.spec.ts` — Expected: PASS. Then the whole suite: `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`, `pnpm build` — Expected: all green.
- [ ] **Step 7: Commit**
  ```bash
  git add "src/app/(app)/invoices" src/components/billing/invoice-editor.tsx e2e/quotations.spec.ts
  git commit -m "feat(quotations): convert from the invoice editor"
  ```

---

### Task 8: Rollout

No code. Follows the project's migration rule (memory: Supabase project `iuwjtvyyghefjkbiqiiq` is the only DB, serving preview and production).

- [ ] **Step 1: Ask the user** before touching the hosted database: "Apply migration 0009_quotations to the Supabase project (it serves production) now?" Wait for a yes.
- [ ] **Step 2: Apply** `drizzle/0009_quotations.sql` with the Supabase MCP `apply_migration` (name `0009_quotations`), using the file as stored in git (`git show HEAD:drizzle/0009_quotations.sql`, LF endings).
- [ ] **Step 3: Insert the drizzle tracking row**: `insert into drizzle.__drizzle_migrations (hash, created_at) values ('<sha256 of the LF file>', <journal "when" for 0009>)`. Verify with `select count(*) from drizzle.__drizzle_migrations` (expected 10) and `select 1 from information_schema.tables where table_name = 'quotations'`.
- [ ] **Step 4: Run** `get_advisors` (security) — expected: only the known "RLS enabled, no policy" INFO for the two new tables.
- [ ] **Step 5: Open the PR** `feature/quotations` → `development` with the summary and test results, using the `superpowers:finishing-a-development-branch` skill. Merging to `main` only when the user asks.
