import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { addDays, colomboDate } from "@/lib/dates";
import { D, fmt } from "@/lib/money";
import { QUOTE_VALID_DAYS, quotationStatus, type QuotationStatus } from "@/lib/quotations";
import { escapeLike } from "@/lib/sql-text";
import { discountSchema, optionalText, saleLinesSchema } from "@/lib/validation";
import type { SessionUser } from "@/server/auth";
import { db, type Tx } from "@/server/db/client";
import {
  customers,
  invoices,
  parts,
  priceTiers,
  profiles,
  quotationItems,
  quotations,
} from "@/server/db/schema";
import { InvalidState, NotFound } from "@/server/errors";
import { getCustomer } from "@/server/services/customers";
// Type-only: invoicing.ts and invoice-drafts.ts import this module at runtime.
import type { EditorDraft } from "@/server/services/invoice-drafts";
import type { InvoiceDetail } from "@/server/services/invoicing";
import {
  assertDiscountAllowed,
  computeTotals,
  lookupPrices,
  resolvePrices,
  type Totals,
} from "@/server/services/pricing";
import { nextNumber } from "@/server/services/sequences";
import { getSettings } from "@/server/services/settings";

export const quotationInputSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  paymentType: z.enum(["cash", "credit"]),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  quoteForName: optionalText(120),
  quoteForPhone: optionalText(40),
  note: optionalText(500),
  lines: saleLinesSchema,
  invoiceDiscount: discountSchema,
});

export type QuotationInput = z.input<typeof quotationInputSchema>;

const cancelReasonSchema = z.string().trim().min(1, "Give a reason for cancelling").max(300);

/** Noon Colombo time on a business date, so the number's year matches the quotation date. */
const atBusinessDate = (date: string) => new Date(`${date}T12:00:00+05:30`);

/**
 * Prices a quotation inside the caller's transaction: locks the customer, checks the parts, applies
 * the customer's tier, VAT and the staff discount cap. Shared by create and update. No stock check:
 * a quotation may offer parts that are out of stock.
 */
async function priceQuotation(
  tx: Tx,
  user: SessionUser,
  data: z.output<typeof quotationInputSchema>,
  quotationDate: string,
  validUntil: string,
) {
  if (validUntil < quotationDate) throw new InvalidState("Valid until can't be before the quotation date");

  const settings = await getSettings(tx);
  const [customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId)).for("update");
  if (!customer) throw new NotFound("Customer not found");
  if (!customer.isActive) throw new InvalidState(`${customer.name} is inactive`);
  if (customer.isWalkIn && data.paymentType === "credit") {
    throw new InvalidState("The walk-in customer can only buy for cash");
  }

  const partIds = [...new Set(data.lines.map((l) => l.partId))];
  const partRows = await tx.select().from(parts).where(inArray(parts.id, partIds));
  const byId = new Map(partRows.map((p) => [p.id, p]));
  for (const id of partIds) {
    const part = byId.get(id);
    if (!part) throw new NotFound("Part not found");
    if (!part.isActive) throw new InvalidState(`${part.sku} is inactive and can't be quoted`);
  }

  const prices = await resolvePrices(tx, customer.tierId, partIds);
  const vatRate = settings.vatEnabled ? settings.vatRate : "0.00";
  const totals = computeTotals(
    data.lines.map((l) => ({ ...l, unitPrice: prices.get(l.partId)! })),
    data.invoiceDiscount,
    vatRate,
  );
  assertDiscountAllowed(user, totals, settings.staffMaxDiscountPct);

  const row = {
    customerId: customer.id,
    quoteForName: customer.isWalkIn ? (data.quoteForName ?? null) : null,
    quoteForPhone: customer.isWalkIn ? (data.quoteForPhone ?? null) : null,
    validUntil,
    paymentType: data.paymentType,
    tierId: customer.tierId,
    vatRate,
    subtotal: totals.subtotal,
    discountTotal: totals.invoiceDiscount,
    vatAmount: totals.vatAmount,
    total: totals.total,
    invoiceDiscountType: data.invoiceDiscount?.type ?? null,
    invoiceDiscountValue: data.invoiceDiscount ? fmt(D(data.invoiceDiscount.value)) : null,
    note: data.note ?? null,
  };
  const items = data.lines.map((l, i) => ({
    lineNo: i + 1,
    partId: l.partId,
    description: byId.get(l.partId)!.name,
    qty: l.qty,
    unitPrice: prices.get(l.partId)!,
    discountType: l.discount?.type ?? null,
    discountValue: l.discount ? fmt(D(l.discount.value)) : null,
    discount: totals.lines[i].discount,
    lineTotal: totals.lines[i].lineTotal,
  }));
  return { row, items };
}

/** Saves a new quotation. It prices the lines but never touches stock, payments or invoices. */
export async function createQuotation(
  user: SessionUser,
  input: QuotationInput,
): Promise<{ id: string; number: string }> {
  const data = quotationInputSchema.parse(input);
  const quotationDate = colomboDate();
  const validUntil = data.validUntil ?? addDays(quotationDate, QUOTE_VALID_DAYS);

  return db.transaction(async (tx) => {
    const { row, items } = await priceQuotation(tx, user, data, quotationDate, validUntil);
    const number = await nextNumber(tx, "QUO", atBusinessDate(quotationDate));
    const [quotation] = await tx
      .insert(quotations)
      .values({ ...row, number, quotationDate, createdBy: user.id, updatedBy: user.id })
      .returning({ id: quotations.id });
    await tx.insert(quotationItems).values(items.map((i) => ({ ...i, quotationId: quotation.id })));
    return { id: quotation.id, number };
  });
}

/** Locks a quotation that can still be changed (open or expired). */
async function lockEditable(tx: Tx, id: string, action: "changed" | "cancelled") {
  if (!z.uuid().safeParse(id).success) throw new NotFound("Quotation not found");
  const [q] = await tx.select().from(quotations).where(eq(quotations.id, id)).for("update");
  if (!q) throw new NotFound("Quotation not found");
  if (q.status === "cancelled") {
    throw new InvalidState(
      action === "cancelled" ? `${q.number} is already cancelled` : `${q.number} is cancelled and can't be changed`,
    );
  }
  if (q.status === "converted") throw new InvalidState(`${q.number} is converted and can't be changed`);
  return q;
}

/** Replaces an open or expired quotation's contents and re-prices it at today's prices. */
export async function updateQuotation(user: SessionUser, id: string, input: QuotationInput): Promise<void> {
  const data = quotationInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const q = await lockEditable(tx, id, "changed");
    const { row, items } = await priceQuotation(tx, user, data, q.quotationDate, data.validUntil ?? q.validUntil);
    await tx
      .update(quotations)
      .set({ ...row, updatedBy: user.id, updatedAt: sql`now()` })
      .where(eq(quotations.id, id));
    await tx.delete(quotationItems).where(eq(quotationItems.quotationId, id));
    await tx.insert(quotationItems).values(items.map((i) => ({ ...i, quotationId: id })));
  });
}

export async function cancelQuotation(user: SessionUser, id: string, reason: string): Promise<void> {
  const why = cancelReasonSchema.parse(reason);
  await db.transaction(async (tx) => {
    await lockEditable(tx, id, "cancelled");
    await tx
      .update(quotations)
      .set({
        status: "cancelled",
        cancelReason: why,
        cancelledBy: user.id,
        cancelledAt: new Date(),
        updatedBy: user.id,
        updatedAt: sql`now()`,
      })
      .where(eq(quotations.id, id));
  });
}

/** Live totals for the quotation editor: same pricing and discount rules, no locks, no writes. */
export async function previewQuotation(
  user: SessionUser,
  input: QuotationInput,
): Promise<Totals & { prices: Record<string, string>; stock: Record<string, number> }> {
  const data = quotationInputSchema.parse(input);
  const settings = await getSettings();
  const [customer] = await db.select().from(customers).where(eq(customers.id, data.customerId));
  if (!customer) throw new NotFound("Customer not found");

  const partIds = data.lines.map((l) => l.partId);
  const prices = await resolvePrices(db, customer.tierId, partIds);
  const totals = computeTotals(
    data.lines.map((l) => ({ ...l, unitPrice: prices.get(l.partId)! })),
    data.invoiceDiscount,
    settings.vatEnabled ? settings.vatRate : "0.00",
  );
  assertDiscountAllowed(user, totals, settings.staffMaxDiscountPct);
  const stockRows = await db
    .select({ id: parts.id, qty: parts.qtyOnHand })
    .from(parts)
    .where(inArray(parts.id, partIds));
  return {
    ...totals,
    prices: Object.fromEntries(prices),
    stock: Object.fromEntries(stockRows.map((r) => [r.id, r.qty])),
  };
}

export type QuotationDetail = {
  id: string;
  number: string;
  quotationDate: string;
  validUntil: string;
  status: QuotationStatus;
  paymentType: "cash" | "credit";
  tierName: string;
  vatRate: string;
  subtotal: string;
  discountTotal: string;
  vatAmount: string;
  total: string;
  note: string | null;
  quoteForName: string | null;
  quoteForPhone: string | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  cancelledByName: string | null;
  invoice: { id: string; number: string } | null;
  convertedAt: Date | null;
  createdAt: Date;
  createdByName: string;
  updatedAt: Date;
  updatedByName: string;
  customer: InvoiceDetail["customer"];
  items: {
    id: string;
    lineNo: number;
    partId: string;
    sku: string;
    description: string;
    qty: number;
    unitPrice: string;
    discount: string;
    lineTotal: string;
  }[];
};

export async function getQuotation(id: string): Promise<QuotationDetail> {
  if (!z.uuid().safeParse(id).success) throw new NotFound("Quotation not found");
  const creator = alias(profiles, "creator");
  const updater = alias(profiles, "updater");
  const canceller = alias(profiles, "canceller");
  const [row] = await db
    .select({
      id: quotations.id,
      number: quotations.number,
      quotationDate: quotations.quotationDate,
      validUntil: quotations.validUntil,
      stored: quotations.status,
      paymentType: quotations.paymentType,
      tierName: priceTiers.name,
      vatRate: quotations.vatRate,
      subtotal: quotations.subtotal,
      discountTotal: quotations.discountTotal,
      vatAmount: quotations.vatAmount,
      total: quotations.total,
      note: quotations.note,
      quoteForName: quotations.quoteForName,
      quoteForPhone: quotations.quoteForPhone,
      cancelReason: quotations.cancelReason,
      cancelledAt: quotations.cancelledAt,
      cancelledByName: canceller.fullName,
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      convertedAt: quotations.convertedAt,
      createdAt: quotations.createdAt,
      createdByName: creator.fullName,
      updatedAt: quotations.updatedAt,
      updatedByName: updater.fullName,
      customer: {
        id: customers.id,
        name: customers.name,
        businessName: customers.businessName,
        phone: customers.phone,
        address: customers.address,
        tin: customers.tin,
        isWalkIn: customers.isWalkIn,
      },
    })
    .from(quotations)
    .innerJoin(customers, eq(customers.id, quotations.customerId))
    .innerJoin(priceTiers, eq(priceTiers.id, quotations.tierId))
    .innerJoin(creator, eq(creator.userId, quotations.createdBy))
    .innerJoin(updater, eq(updater.userId, quotations.updatedBy))
    .leftJoin(canceller, eq(canceller.userId, quotations.cancelledBy))
    .leftJoin(invoices, eq(invoices.id, quotations.invoiceId))
    .where(eq(quotations.id, id));
  if (!row) throw new NotFound("Quotation not found");

  const items = await db
    .select({
      id: quotationItems.id,
      lineNo: quotationItems.lineNo,
      partId: quotationItems.partId,
      sku: parts.sku,
      description: quotationItems.description,
      qty: quotationItems.qty,
      unitPrice: quotationItems.unitPrice,
      discount: quotationItems.discount,
      lineTotal: quotationItems.lineTotal,
    })
    .from(quotationItems)
    .innerJoin(parts, eq(parts.id, quotationItems.partId))
    .where(eq(quotationItems.quotationId, id))
    .orderBy(asc(quotationItems.lineNo));

  const { stored, invoiceId, invoiceNumber, ...rest } = row;
  return {
    ...rest,
    status: quotationStatus(stored, row.validUntil, colomboDate()),
    invoice: invoiceId && invoiceNumber ? { id: invoiceId, number: invoiceNumber } : null,
    items,
  };
}

export type QuotationListRow = {
  id: string;
  number: string;
  quotationDate: string;
  validUntil: string;
  customerName: string;
  quoteForName: string | null;
  isWalkIn: boolean;
  total: string;
  status: QuotationStatus;
  invoiceNumber: string | null;
};

export async function listQuotations(
  filters: { q?: string; status?: QuotationStatus; limit?: number } = {},
): Promise<QuotationListRow[]> {
  const today = colomboDate();
  const where: SQL[] = [];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      sql`(${quotations.number} ilike ${like} or ${customers.name} ilike ${like} or ${customers.businessName} ilike ${like}
        or ${customers.phone} ilike ${like} or ${quotations.quoteForName} ilike ${like} or ${quotations.quoteForPhone} ilike ${like})`,
    );
  }
  if (filters.status === "expired") {
    where.push(and(eq(quotations.status, "open"), sql`${quotations.validUntil} < ${today}`)!);
  } else if (filters.status === "open") {
    where.push(and(eq(quotations.status, "open"), sql`${quotations.validUntil} >= ${today}`)!);
  } else if (filters.status) {
    where.push(eq(quotations.status, filters.status));
  }

  const rows = await db
    .select({
      id: quotations.id,
      number: quotations.number,
      quotationDate: quotations.quotationDate,
      validUntil: quotations.validUntil,
      customerName: customers.name,
      quoteForName: quotations.quoteForName,
      isWalkIn: customers.isWalkIn,
      total: quotations.total,
      stored: quotations.status,
      invoiceNumber: invoices.number,
    })
    .from(quotations)
    .innerJoin(customers, eq(customers.id, quotations.customerId))
    .leftJoin(invoices, eq(invoices.id, quotations.invoiceId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(quotations.quotationDate), desc(quotations.number))
    .limit(filters.limit ?? 200);
  return rows.map(({ stored, ...r }) => ({ ...r, status: quotationStatus(stored, r.validUntil, today) }));
}

export type QuotationEditorData = Omit<EditorDraft, "id" | "cashPayment"> & {
  id: string;
  number: string;
  validUntil: string;
  quoteForName: string | null;
  quoteForPhone: string | null;
  note: string | null;
};

/**
 * A quotation ready to reopen in the editor, with today's stock and the customer's current prices
 * (display only; saving re-prices). Null when it's unknown, converted or cancelled.
 */
export async function getQuotationForEditor(id: string): Promise<QuotationEditorData | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [q] = await db.select().from(quotations).where(eq(quotations.id, id));
  if (!q || q.status !== "open") return null;

  const customer = await getCustomer(q.customerId);
  const items = await db
    .select()
    .from(quotationItems)
    .where(eq(quotationItems.quotationId, id))
    .orderBy(asc(quotationItems.lineNo));
  const partIds = items.map((i) => i.partId);
  const [partRows, prices] = await Promise.all([
    db
      .select({
        id: parts.id,
        sku: parts.sku,
        name: parts.name,
        oemPartNo: parts.oemPartNo,
        qtyOnHand: parts.qtyOnHand,
        unit: parts.unit,
      })
      .from(parts)
      .where(inArray(parts.id, partIds)),
    lookupPrices(db, customer.tierId, partIds),
  ]);
  const byId = new Map(partRows.map((p) => [p.id, p]));

  return {
    id: q.id,
    number: q.number,
    customer,
    paymentType: q.paymentType,
    validUntil: q.validUntil,
    quoteForName: q.quoteForName,
    quoteForPhone: q.quoteForPhone,
    note: q.note,
    lines: items.map((i) => ({
      part: { ...byId.get(i.partId)!, price: prices.get(i.partId) },
      qty: i.qty,
      discount:
        i.discountType && i.discountValue
          ? { type: i.discountType as "amount" | "percent", value: i.discountValue }
          : undefined,
    })),
    invoiceDiscount:
      q.invoiceDiscountType && q.invoiceDiscountValue
        ? { type: q.invoiceDiscountType as "amount" | "percent", value: q.invoiceDiscountValue }
        : undefined,
  };
}
