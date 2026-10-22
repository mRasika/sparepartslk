import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { parts } from "./catalog";
import { audit, money } from "./columns";
import { customers, suppliers } from "./parties";
import {
  adjustmentReasonEnum,
  invoiceStatusEnum,
  paymentMethodEnum,
  paymentStatusEnum,
  paymentTypeEnum,
  priceTiers,
  profiles,
} from "./reference";

export const grns = pgTable("grns", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  supplierInvoiceNo: text("supplier_invoice_no"),
  receivedDate: date("received_date", { mode: "string" }).notNull(),
  total: money("total").notNull(),
  note: text("note"),
  ...audit(),
});

export const grnItems = pgTable(
  "grn_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grnId: uuid("grn_id")
      .notNull()
      .references(() => grns.id),
    lineNo: integer("line_no").notNull(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    qty: integer("qty").notNull(),
    unitCost: money("unit_cost").notNull(),
  },
  (t) => [
    check("grn_items_qty_positive", sql`${t.qty} > 0`),
    check("grn_items_unit_cost_non_negative", sql`${t.unitCost} >= 0`),
    index("grn_items_grn_idx").on(t.grnId),
    index("grn_items_part_idx").on(t.partId),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    paymentType: paymentTypeEnum("payment_type").notNull(),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => priceTiers.id),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2, mode: "string" }).notNull(),
    subtotal: money("subtotal").notNull(),
    /** Invoice-level discount (line discounts are already inside subtotal). */
    discountTotal: money("discount_total").notNull(),
    vatAmount: money("vat_amount").notNull(),
    total: money("total").notNull(),
    status: invoiceStatusEnum("status").notNull().default("issued"),
    creditOverride: boolean("credit_override").notNull().default(false),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => profiles.userId),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...audit(),
  },
  (t) => [
    index("invoices_customer_status_idx").on(t.customerId, t.status),
    index("invoices_invoice_date_idx").on(t.invoiceDate),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    lineNo: integer("line_no").notNull(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    description: text("description").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    discount: money("discount").notNull().default("0.00"),
    lineTotal: money("line_total").notNull(),
    unitCost: money("unit_cost").notNull(),
  },
  (t) => [
    check("invoice_items_qty_positive", sql`${t.qty} > 0`),
    index("invoice_items_invoice_idx").on(t.invoiceId),
    index("invoice_items_part_idx").on(t.partId),
  ],
);

export const salesReturns = pgTable(
  "sales_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    returnDate: date("return_date", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    subtotal: money("subtotal").notNull(),
    total: money("total").notNull(),
    ...audit(),
  },
  (t) => [
    index("sales_returns_invoice_idx").on(t.invoiceId),
    index("sales_returns_customer_idx").on(t.customerId),
  ],
);

export const salesReturnItems = pgTable(
  "sales_return_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => salesReturns.id),
    invoiceItemId: uuid("invoice_item_id")
      .notNull()
      .references(() => invoiceItems.id),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    qty: integer("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    lineTotal: money("line_total").notNull(),
    restock: boolean("restock").notNull(),
  },
  (t) => [
    check("sales_return_items_qty_positive", sql`${t.qty} > 0`),
    index("sales_return_items_return_idx").on(t.returnId),
    index("sales_return_items_invoice_item_idx").on(t.invoiceItemId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    /** Negative for refunds. */
    amount: money("amount").notNull(),
    method: paymentMethodEnum("method").notNull(),
    reference: text("reference"),
    isRefund: boolean("is_refund").notNull().default(false),
    status: paymentStatusEnum("status").notNull().default("active"),
    /** Set only on the automatic cash payment created with an invoice. */
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    /** Set only on refunds. */
    returnId: uuid("return_id").references(() => salesReturns.id),
    ...audit(),
  },
  (t) => [
    check(
      "payments_amount_sign",
      sql`(${t.isRefund} and ${t.amount} < 0) or (not ${t.isRefund} and ${t.amount} > 0)`,
    ),
    index("payments_customer_idx").on(t.customerId),
    index("payments_invoice_idx").on(t.invoiceId),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: money("amount").notNull(),
  },
  (t) => [
    check("payment_allocations_amount_positive", sql`${t.amount} > 0`),
    index("payment_allocations_payment_idx").on(t.paymentId),
    index("payment_allocations_invoice_idx").on(t.invoiceId),
  ],
);

export const stockAdjustments = pgTable("stock_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(),
  reason: adjustmentReasonEnum("reason").notNull(),
  note: text("note"),
  ...audit(),
});

export const stockAdjustmentItems = pgTable(
  "stock_adjustment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adjustmentId: uuid("adjustment_id")
      .notNull()
      .references(() => stockAdjustments.id),
    lineNo: integer("line_no").notNull(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    qtyChange: integer("qty_change").notNull(),
    unitCost: money("unit_cost").notNull(),
  },
  (t) => [
    check("stock_adjustment_items_qty_change_non_zero", sql`${t.qtyChange} <> 0`),
    index("stock_adjustment_items_adjustment_idx").on(t.adjustmentId),
  ],
);
