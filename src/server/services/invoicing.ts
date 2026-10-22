import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { addDays, colomboDate } from "@/lib/dates";
import { D } from "@/lib/money";
import { escapeLike } from "@/lib/sql-text";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import {
  customers,
  invoiceItems,
  invoices,
  parts,
  paymentAllocations,
  payments,
  priceTiers,
  profiles,
} from "@/server/db/schema";
import {
  CreditLimitExceeded,
  Forbidden,
  InsufficientStock,
  InvalidState,
  NotFound,
} from "@/server/errors";
import { toStaffView } from "@/server/services/catalog";
import { customerBalance } from "@/server/services/customers";
import { applyMovement, lockParts } from "@/server/services/inventory";
import {
  assertDiscountAllowed,
  computeTotals,
  resolvePrices,
  type Totals,
} from "@/server/services/pricing";
import { nextNumber } from "@/server/services/sequences";
import { getSettings } from "@/server/services/settings";

const discountSchema = z
  .object({
    type: z.enum(["amount", "percent"]),
    value: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter a discount like 50 or 12.5"),
  })
  .optional();

export const invoiceInputSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  paymentType: z.enum(["cash", "credit"]),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  lines: z
    .array(
      z.object({
        partId: z.uuid(),
        qty: z.coerce.number().int("Use whole units").positive("Quantity must be at least 1"),
        discount: discountSchema,
      }),
    )
    .min(1, "Add at least one part"),
  invoiceDiscount: discountSchema,
  overrideCreditLimit: z.boolean().optional(),
  cashPayment: z
    .object({
      method: z.enum(["cash", "bank", "cheque"]),
      reference: z.string().trim().max(80).optional(),
    })
    .optional(),
});

export type InvoiceInput = z.input<typeof invoiceInputSchema>;

/** Noon Colombo time on a business date, so the number's year matches the invoice date. */
const atBusinessDate = (date: string) => new Date(`${date}T12:00:00+05:30`);

/**
 * Issues an invoice in one transaction (spec §5.1). Any failure rolls back everything,
 * including the invoice number, so numbers stay gapless.
 */
export async function createInvoice(
  user: SessionUser,
  input: InvoiceInput,
): Promise<{ id: string; number: string }> {
  const data = invoiceInputSchema.parse(input);
  if (data.overrideCreditLimit && user.role !== "admin") {
    throw new Forbidden("Only an admin can override a credit limit");
  }

  return db.transaction(async (tx) => {
    // 1. Settings and customer. The customer row lock serialises credit checks per customer.
    const settings = await getSettings(tx);
    const [customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId)).for("update");
    if (!customer) throw new NotFound("Customer not found");
    if (!customer.isActive) throw new InvalidState(`${customer.name} is inactive`);
    // 2. Walk-in customers always pay cash.
    if (customer.isWalkIn && data.paymentType === "credit") {
      throw new InvalidState("The walk-in customer can only buy for cash");
    }

    // 3–5. Prices, totals and the staff discount cap.
    const prices = await resolvePrices(tx, customer.tierId, data.lines.map((l) => l.partId));
    const vatRate = settings.vatEnabled ? settings.vatRate : "0.00";
    const totals = computeTotals(
      data.lines.map((l) => ({ ...l, unitPrice: prices.get(l.partId)! })),
      data.invoiceDiscount,
      vatRate,
    );
    assertDiscountAllowed(user, totals, settings.staffMaxDiscountPct);

    // 6. Lock parts; check stock against the qty summed across lines.
    const locked = await lockParts(tx, data.lines.map((l) => l.partId));
    const requested = new Map<string, number>();
    for (const l of data.lines) requested.set(l.partId, (requested.get(l.partId) ?? 0) + l.qty);
    for (const [partId, qty] of requested) {
      const part = locked.get(partId)!;
      if (!part.isActive) throw new InvalidState(`${part.sku} is inactive and can't be sold`);
      if (qty > part.qtyOnHand) {
        throw new InsufficientStock({ partId, sku: part.sku, available: part.qtyOnHand, requested: qty });
      }
    }

    // 7. Credit limit.
    let creditOverride = false;
    if (data.paymentType === "credit") {
      const balance = await customerBalance(tx, customer.id);
      if (D(balance).plus(totals.total).greaterThan(customer.creditLimit)) {
        if (!data.overrideCreditLimit) {
          throw new CreditLimitExceeded({ balance, limit: customer.creditLimit, invoiceTotal: totals.total });
        }
        creditOverride = true;
      }
    }

    // 8–9. Number and insert.
    const invoiceDate = data.invoiceDate ?? colomboDate();
    const number = await nextNumber(tx, "INV", atBusinessDate(invoiceDate));
    const [invoice] = await tx
      .insert(invoices)
      .values({
        number,
        customerId: customer.id,
        invoiceDate,
        dueDate: data.paymentType === "credit" ? addDays(invoiceDate, customer.creditDays) : invoiceDate,
        paymentType: data.paymentType,
        tierId: customer.tierId,
        vatRate,
        subtotal: totals.subtotal,
        discountTotal: totals.invoiceDiscount,
        vatAmount: totals.vatAmount,
        total: totals.total,
        creditOverride,
        createdBy: user.id,
      })
      .returning({ id: invoices.id });

    await tx.insert(invoiceItems).values(
      data.lines.map((l, i) => {
        const part = locked.get(l.partId)!;
        return {
          invoiceId: invoice.id,
          lineNo: i + 1,
          partId: l.partId,
          description: part.name,
          qty: l.qty,
          unitPrice: prices.get(l.partId)!,
          discount: totals.lines[i].discount,
          lineTotal: totals.lines[i].lineTotal,
          unitCost: part.avgCost,
        };
      }),
    );

    // 10. Stock out.
    for (const l of data.lines) {
      const part = locked.get(l.partId)!;
      const updated = await applyMovement(tx, part, {
        type: "SALE",
        qtyChange: -l.qty,
        unitCost: part.avgCost,
        refType: "invoice",
        refId: invoice.id,
        userId: user.id,
        affectsAvgCost: false,
      });
      locked.set(l.partId, updated);
    }

    // 11. A cash sale is paid in full on the spot.
    if (data.paymentType === "cash" && D(totals.total).greaterThan(0)) {
      const payNumber = await nextNumber(tx, "PAY", atBusinessDate(invoiceDate));
      const [payment] = await tx
        .insert(payments)
        .values({
          number: payNumber,
          customerId: customer.id,
          paymentDate: invoiceDate,
          amount: totals.total,
          method: data.cashPayment?.method ?? "cash",
          reference: data.cashPayment?.reference || null,
          invoiceId: invoice.id,
          createdBy: user.id,
        })
        .returning({ id: payments.id });
      await tx.insert(paymentAllocations).values({ paymentId: payment.id, invoiceId: invoice.id, amount: totals.total });
    }

    return { id: invoice.id, number };
  });
}

/** Live totals for the invoice editor: same pricing and discount rules, no locks, no writes. */
export async function previewInvoice(
  user: SessionUser,
  input: InvoiceInput,
): Promise<Totals & { prices: Record<string, string>; stock: Record<string, number> }> {
  const data = invoiceInputSchema.parse(input);
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

export type InvoiceListRow = {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  customerId: string;
  customerName: string;
  paymentType: "cash" | "credit";
  total: string;
  status: "issued" | "cancelled";
};

export async function listInvoices(
  filters: {
    q?: string;
    customerId?: string;
    status?: "issued" | "cancelled";
    from?: string;
    to?: string;
    limit?: number;
  } = {},
): Promise<InvoiceListRow[]> {
  const where: SQL[] = [];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(sql`(${invoices.number} ilike ${like} or ${customers.name} ilike ${like} or ${customers.businessName} ilike ${like})`);
  }
  if (filters.customerId) where.push(eq(invoices.customerId, filters.customerId));
  if (filters.status) where.push(eq(invoices.status, filters.status));
  if (filters.from) where.push(gte(invoices.invoiceDate, filters.from));
  if (filters.to) where.push(lte(invoices.invoiceDate, filters.to));

  return db
    .select({
      id: invoices.id,
      number: invoices.number,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      customerId: invoices.customerId,
      customerName: customers.name,
      paymentType: invoices.paymentType,
      total: invoices.total,
      status: invoices.status,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(invoices.invoiceDate), desc(invoices.number))
    .limit(filters.limit ?? 200);
}

export type InvoiceDetail = {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  paymentType: "cash" | "credit";
  status: "issued" | "cancelled";
  tierName: string;
  vatRate: string;
  subtotal: string;
  discountTotal: string;
  vatAmount: string;
  total: string;
  creditOverride: boolean;
  cancelReason: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  createdByName: string;
  customer: {
    id: string;
    name: string;
    businessName: string | null;
    phone: string | null;
    address: string | null;
    tin: string | null;
    isWalkIn: boolean;
  };
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
    unitCost?: string;
  }[];
};

export async function getInvoice(user: SessionUser, id: string): Promise<InvoiceDetail> {
  if (!z.uuid().safeParse(id).success) throw new NotFound("Invoice not found");
  const [row] = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      paymentType: invoices.paymentType,
      status: invoices.status,
      tierName: priceTiers.name,
      vatRate: invoices.vatRate,
      subtotal: invoices.subtotal,
      discountTotal: invoices.discountTotal,
      vatAmount: invoices.vatAmount,
      total: invoices.total,
      creditOverride: invoices.creditOverride,
      cancelReason: invoices.cancelReason,
      cancelledAt: invoices.cancelledAt,
      createdAt: invoices.createdAt,
      createdByName: profiles.fullName,
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
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(priceTiers, eq(priceTiers.id, invoices.tierId))
    .innerJoin(profiles, eq(profiles.userId, invoices.createdBy))
    .where(eq(invoices.id, id));
  if (!row) throw new NotFound("Invoice not found");

  const items = await db
    .select({
      id: invoiceItems.id,
      lineNo: invoiceItems.lineNo,
      partId: invoiceItems.partId,
      sku: parts.sku,
      description: invoiceItems.description,
      qty: invoiceItems.qty,
      unitPrice: invoiceItems.unitPrice,
      discount: invoiceItems.discount,
      lineTotal: invoiceItems.lineTotal,
      unitCost: invoiceItems.unitCost,
    })
    .from(invoiceItems)
    .innerJoin(parts, eq(parts.id, invoiceItems.partId))
    .where(eq(invoiceItems.invoiceId, id))
    .orderBy(asc(invoiceItems.lineNo));

  return { ...row, items: items.map((i) => toStaffView(user, i)) };
}
