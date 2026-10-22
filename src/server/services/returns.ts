import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { colomboDate } from "@/lib/dates";
import { D, fmt, round2, sum } from "@/lib/money";
import { optionalText } from "@/lib/validation";
import type { SessionUser } from "@/server/auth";
import { db, type Executor } from "@/server/db/client";
import {
  customers,
  invoiceItems,
  invoices,
  parts,
  payments,
  profiles,
  salesReturnItems,
  salesReturns,
} from "@/server/db/schema";
import { InvalidState, NotFound, ReturnQtyExceeded } from "@/server/errors";
import { applyMovement, lockParts } from "@/server/services/inventory";
import { nextNumber } from "@/server/services/sequences";

export const returnInputSchema = z.object({
  invoiceId: z.uuid(),
  reason: z.string().trim().min(1, "Give a reason for the return").max(300),
  lines: z
    .array(
      z.object({
        invoiceItemId: z.uuid(),
        qty: z.coerce.number().int("Use whole units").positive("Quantity must be at least 1"),
        restock: z.boolean(),
      }),
    )
    .min(1, "Choose at least one item to return"),
  refund: z
    .object({
      method: z.enum(["cash", "bank"]),
      reference: optionalText(80),
    })
    .optional(),
});

export type ReturnInput = z.input<typeof returnInputSchema>;

/** Qty already returned per invoice line. */
async function returnedQty(tx: Executor, invoiceId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ itemId: salesReturnItems.invoiceItemId, qty: sql<number>`sum(${salesReturnItems.qty})::int` })
    .from(salesReturnItems)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnItems.returnId))
    .where(eq(salesReturns.invoiceId, invoiceId))
    .groupBy(salesReturnItems.invoiceItemId);
  return new Map(rows.map((r) => [r.itemId, r.qty]));
}

/**
 * Credit note against an issued invoice (spec §5.4). Each line is credited at its share of the
 * discounted line total; the note's total then carries the invoice discount and VAT through the
 * invoice's own total/subtotal ratio. Restocked lines come back at the original cost.
 */
export async function createReturn(
  user: SessionUser,
  input: ReturnInput,
): Promise<{ id: string; number: string; subtotal: string; total: string; refundPaymentId?: string }> {
  const data = returnInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, data.invoiceId)).for("update");
    if (!invoice) throw new NotFound("Invoice not found");
    if (invoice.status !== "issued") throw new InvalidState(`${invoice.number} is cancelled; nothing can be returned`);

    const [customer] = await tx.select().from(customers).where(eq(customers.id, invoice.customerId));
    if (customer.isWalkIn && !data.refund) {
      throw new InvalidState("Walk-in returns must be refunded; choose how the money goes back");
    }

    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
    const already = await returnedQty(tx, invoice.id);
    const seen = new Set<string>();
    const lines = data.lines.map((l) => {
      const item = items.find((i) => i.id === l.invoiceItemId);
      if (!item) throw new InvalidState("That item isn't on this invoice", { invoiceItemId: l.invoiceItemId });
      if (seen.has(item.id)) throw new InvalidState(`${item.description} is listed twice`);
      seen.add(item.id);
      const returnable = item.qty - (already.get(item.id) ?? 0);
      if (l.qty > returnable) {
        throw new ReturnQtyExceeded({ invoiceItemId: item.id, returnable, requested: l.qty });
      }
      const lineTotal = round2(D(l.qty).times(item.lineTotal).div(item.qty));
      return { ...l, item, lineTotal, unitPrice: round2(D(item.lineTotal).div(item.qty)) };
    });

    const subtotal = sum(lines.map((l) => l.lineTotal));
    const total = D(invoice.subtotal).isZero()
      ? D(0)
      : round2(subtotal.times(invoice.total).div(invoice.subtotal));

    const returnDate = colomboDate();
    const at = new Date(`${returnDate}T12:00:00+05:30`);
    const number = await nextNumber(tx, "CRN", at);
    const [ret] = await tx
      .insert(salesReturns)
      .values({
        number,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        returnDate,
        reason: data.reason,
        subtotal: fmt(subtotal),
        total: fmt(total),
        createdBy: user.id,
      })
      .returning({ id: salesReturns.id });

    await tx.insert(salesReturnItems).values(
      lines.map((l) => ({
        returnId: ret.id,
        invoiceItemId: l.item.id,
        partId: l.item.partId,
        qty: l.qty,
        unitPrice: fmt(l.unitPrice),
        lineTotal: fmt(l.lineTotal),
        restock: l.restock,
      })),
    );

    const restocked = lines.filter((l) => l.restock);
    const locked = await lockParts(tx, restocked.map((l) => l.item.partId));
    for (const l of restocked) {
      const updated = await applyMovement(tx, locked.get(l.item.partId)!, {
        type: "RETURN",
        qtyChange: l.qty,
        unitCost: l.item.unitCost,
        refType: "return",
        refId: ret.id,
        userId: user.id,
        affectsAvgCost: true,
      });
      locked.set(l.item.partId, updated);
    }

    let refundPaymentId: string | undefined;
    if (data.refund && total.greaterThan(0)) {
      const payNumber = await nextNumber(tx, "PAY", at);
      const [refund] = await tx
        .insert(payments)
        .values({
          number: payNumber,
          customerId: invoice.customerId,
          paymentDate: returnDate,
          amount: fmt(total.negated()),
          method: data.refund.method,
          reference: data.refund.reference,
          isRefund: true,
          returnId: ret.id,
          createdBy: user.id,
        })
        .returning({ id: payments.id });
      refundPaymentId = refund.id;
    }

    return { id: ret.id, number, subtotal: fmt(subtotal), total: fmt(total), refundPaymentId };
  });
}

export type ReturnableItem = {
  invoiceItemId: string;
  sku: string;
  description: string;
  sold: number;
  returned: number;
  returnable: number;
  unitPrice: string;
  lineTotal: string;
};

/** Invoice lines with how many can still come back, for the return form. */
export async function returnableItems(invoiceId: string): Promise<ReturnableItem[]> {
  const items = await db
    .select({
      id: invoiceItems.id,
      sku: parts.sku,
      description: invoiceItems.description,
      qty: invoiceItems.qty,
      lineTotal: invoiceItems.lineTotal,
    })
    .from(invoiceItems)
    .innerJoin(parts, eq(parts.id, invoiceItems.partId))
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(asc(invoiceItems.lineNo));
  const already = await returnedQty(db, invoiceId);
  return items.map((i) => {
    const returned = already.get(i.id) ?? 0;
    return {
      invoiceItemId: i.id,
      sku: i.sku,
      description: i.description,
      sold: i.qty,
      returned,
      returnable: i.qty - returned,
      unitPrice: fmt(round2(D(i.lineTotal).div(i.qty))),
      lineTotal: i.lineTotal,
    };
  });
}

export async function listReturns(filters: { invoiceId?: string } = {}) {
  return db
    .select({
      id: salesReturns.id,
      number: salesReturns.number,
      returnDate: salesReturns.returnDate,
      invoiceId: salesReturns.invoiceId,
      invoiceNumber: invoices.number,
      customerId: salesReturns.customerId,
      customerName: customers.name,
      reason: salesReturns.reason,
      total: salesReturns.total,
    })
    .from(salesReturns)
    .innerJoin(invoices, eq(invoices.id, salesReturns.invoiceId))
    .innerJoin(customers, eq(customers.id, salesReturns.customerId))
    .where(filters.invoiceId ? eq(salesReturns.invoiceId, filters.invoiceId) : undefined)
    .orderBy(desc(salesReturns.createdAt))
    .limit(200);
}

export async function getReturn(id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFound("Credit note not found");
  const [header] = await db
    .select({
      id: salesReturns.id,
      number: salesReturns.number,
      returnDate: salesReturns.returnDate,
      invoiceId: salesReturns.invoiceId,
      invoiceNumber: invoices.number,
      customerId: salesReturns.customerId,
      customerName: customers.name,
      reason: salesReturns.reason,
      subtotal: salesReturns.subtotal,
      total: salesReturns.total,
      createdByName: profiles.fullName,
      createdAt: salesReturns.createdAt,
    })
    .from(salesReturns)
    .innerJoin(invoices, eq(invoices.id, salesReturns.invoiceId))
    .innerJoin(customers, eq(customers.id, salesReturns.customerId))
    .innerJoin(profiles, eq(profiles.userId, salesReturns.createdBy))
    .where(eq(salesReturns.id, id));
  if (!header) throw new NotFound("Credit note not found");

  const [items, refunds] = await Promise.all([
    db
      .select({
        id: salesReturnItems.id,
        sku: parts.sku,
        description: invoiceItems.description,
        qty: salesReturnItems.qty,
        unitPrice: salesReturnItems.unitPrice,
        lineTotal: salesReturnItems.lineTotal,
        restock: salesReturnItems.restock,
      })
      .from(salesReturnItems)
      .innerJoin(invoiceItems, eq(invoiceItems.id, salesReturnItems.invoiceItemId))
      .innerJoin(parts, eq(parts.id, salesReturnItems.partId))
      .where(eq(salesReturnItems.returnId, id))
      .orderBy(asc(invoiceItems.lineNo)),
    db
      .select({ number: payments.number, amount: payments.amount, method: payments.method })
      .from(payments)
      .where(and(eq(payments.returnId, id), inArray(payments.status, ["active"]))),
  ]);
  return { ...header, items, refund: refunds[0] ?? null };
}
