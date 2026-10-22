import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { colomboDate } from "@/lib/dates";
import { D, fmt, sum } from "@/lib/money";
import { escapeLike } from "@/lib/sql-text";
import { moneyString, optionalText } from "@/lib/validation";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers, paymentAllocations, payments, profiles } from "@/server/db/schema";
import { Forbidden, InvalidState, NotFound } from "@/server/errors";
import { outstandingInvoices } from "@/server/services/customers";
import { nextNumber } from "@/server/services/sequences";

export const paymentInputSchema = z
  .object({
    customerId: z.uuid("Choose a customer"),
    amount: moneyString.refine((v) => D(v).greaterThan(0), "Amount must be more than 0"),
    method: z.enum(["cash", "bank", "cheque"]),
    reference: optionalText(80),
    paymentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    allocations: z.array(z.object({ invoiceId: z.uuid(), amount: moneyString })).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.method !== "cash" && !v.reference) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: v.method === "cheque" ? "Enter the cheque number" : "Enter the transfer reference",
      });
    }
  });

export type PaymentInput = z.input<typeof paymentInputSchema>;

/**
 * Receives money from a customer (spec §5.5). Without explicit allocations it pays open invoices
 * oldest-due first; whatever is left stays on the account as unapplied credit.
 */
export async function receivePayment(
  user: SessionUser,
  input: PaymentInput,
): Promise<{ id: string; number: string; unapplied: string }> {
  const data = paymentInputSchema.parse(input);
  if (data.allocations && user.role !== "admin") {
    throw new Forbidden("Only an admin can choose which invoices a payment settles");
  }

  return db.transaction(async (tx) => {
    // Lock the customer so concurrent payments/invoices see a consistent outstanding.
    const [customer] = await tx.select().from(customers).where(eq(customers.id, data.customerId)).for("update");
    if (!customer) throw new NotFound("Customer not found");

    const open = await outstandingInvoices({ customerId: customer.id }, tx);
    const plan: { invoiceId: string; amount: string }[] = [];

    if (data.allocations) {
      const seen = new Set<string>();
      for (const a of data.allocations) {
        const inv = open.find((o) => o.invoiceId === a.invoiceId);
        if (!inv) throw new InvalidState("That invoice isn't open for this customer", { invoiceId: a.invoiceId });
        if (seen.has(a.invoiceId)) throw new InvalidState(`${inv.number} is listed twice`);
        seen.add(a.invoiceId);
        if (D(a.amount).greaterThan(inv.outstanding)) {
          throw new InvalidState(`${inv.number} only has Rs ${inv.outstanding} outstanding`, { invoiceId: a.invoiceId });
        }
        if (D(a.amount).greaterThan(0)) plan.push(a);
      }
      if (sum(plan.map((a) => D(a.amount))).greaterThan(data.amount)) {
        throw new InvalidState("Allocations add up to more than the payment");
      }
    } else {
      let remaining = D(data.amount);
      for (const inv of open) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const take = D(inv.outstanding).lessThan(remaining) ? D(inv.outstanding) : remaining;
        plan.push({ invoiceId: inv.invoiceId, amount: fmt(take) });
        remaining = remaining.minus(take);
      }
    }

    const paymentDate = data.paymentDate ?? colomboDate();
    const number = await nextNumber(tx, "PAY", new Date(`${paymentDate}T12:00:00+05:30`));
    const [payment] = await tx
      .insert(payments)
      .values({
        number,
        customerId: customer.id,
        paymentDate,
        amount: data.amount,
        method: data.method,
        reference: data.reference,
        createdBy: user.id,
      })
      .returning({ id: payments.id });
    if (plan.length) {
      await tx.insert(paymentAllocations).values(plan.map((a) => ({ paymentId: payment.id, ...a })));
    }
    const applied = sum(plan.map((a) => D(a.amount)));
    return { id: payment.id, number, unapplied: fmt(D(data.amount).minus(applied)) };
  });
}

export type PaymentListRow = {
  id: string;
  number: string;
  paymentDate: string;
  customerId: string;
  customerName: string;
  amount: string;
  method: "cash" | "bank" | "cheque";
  reference: string | null;
  isRefund: boolean;
  status: "active" | "cancelled";
  invoiceId: string | null;
  createdByName: string;
  allocated: string;
};

export async function listPayments(filters: { q?: string; customerId?: string } = {}): Promise<PaymentListRow[]> {
  const where: SQL[] = [];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(sql`(${payments.number} ilike ${like} or ${customers.name} ilike ${like} or ${payments.reference} ilike ${like})`);
  }
  if (filters.customerId) where.push(eq(payments.customerId, filters.customerId));
  return db
    .select({
      id: payments.id,
      number: payments.number,
      paymentDate: payments.paymentDate,
      customerId: payments.customerId,
      customerName: customers.name,
      amount: payments.amount,
      method: payments.method,
      reference: payments.reference,
      isRefund: payments.isRefund,
      status: payments.status,
      invoiceId: payments.invoiceId,
      createdByName: profiles.fullName,
      allocated: sql<string>`coalesce((select sum(${paymentAllocations.amount}) from ${paymentAllocations}
        where ${paymentAllocations.paymentId} = ${payments.id}), 0)::numeric(12, 2)::text`,
    })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .innerJoin(profiles, eq(profiles.userId, payments.createdBy))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(payments.paymentDate), desc(payments.number))
    .limit(200);
}

/** Payments (incl. refunds) recorded against one invoice, for its detail page. */
export async function paymentsForInvoice(invoiceId: string) {
  return db
    .select({
      paymentId: payments.id,
      number: payments.number,
      paymentDate: payments.paymentDate,
      method: payments.method,
      status: payments.status,
      amount: paymentAllocations.amount,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(eq(paymentAllocations.invoiceId, invoiceId))
    .orderBy(payments.paymentDate);
}
