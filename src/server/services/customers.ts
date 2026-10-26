import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { colomboDate } from "@/lib/dates";
import { D, fmt } from "@/lib/money";
import { escapeLike } from "@/lib/sql-text";
import { moneyString, optionalText } from "@/lib/validation";
import type { SessionUser } from "@/server/auth";
import { db, type Executor } from "@/server/db/client";
import {
  customers,
  invoices,
  paymentAllocations,
  payments,
  priceTiers,
  salesReturns,
} from "@/server/db/schema";
import { Forbidden, InvalidState, NotFound } from "@/server/errors";
import { getSettings } from "@/server/services/settings";

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  businessName: optionalText(160),
  phone: optionalText(40),
  address: optionalText(300),
  tin: optionalText(40),
  tierId: z.uuid("Choose a price tier"),
  creditLimit: moneyString,
  creditDays: z.coerce.number().int().min(0).max(365),
  isActive: z.boolean(),
});

export type CustomerInput = z.input<typeof customerInputSchema>;

/**
 * What the customer owes (spec §4): issued invoice totals − active payments (refunds are negative)
 * − credit notes. Negative means the store owes the customer credit.
 */
export async function customerBalance(tx: Executor, customerId: string): Promise<string> {
  const [row] = await tx.execute<{ balance: string }>(sql`
    select (
      coalesce((select sum(${invoices.total}) from ${invoices}
                where ${invoices.customerId} = ${customerId} and ${invoices.status} = 'issued'), 0)
      - coalesce((select sum(${payments.amount}) from ${payments}
                  where ${payments.customerId} = ${customerId} and ${payments.status} = 'active'), 0)
      - coalesce((select sum(${salesReturns.total}) from ${salesReturns}
                  where ${salesReturns.customerId} = ${customerId}), 0)
    )::numeric(12, 2)::text as balance
  `);
  return row.balance;
}

/**
 * Per invoice (spec §4): settled = min(total, active allocations + credit notes against it);
 * outstanding = total − settled. Cancelled payments don't count.
 */
export async function invoiceOutstanding(
  tx: Executor,
  invoiceIds: string[],
): Promise<Map<string, { settled: string; outstanding: string }>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; settled: string; outstanding: string }>(sql`
    select id, settled::text, (total - settled)::numeric(12, 2)::text as outstanding
    from (
      select i.id, i.total, least(i.total,
        coalesce((select sum(pa.amount) from ${paymentAllocations} pa
                  join ${payments} p on p.id = pa.payment_id
                  where pa.invoice_id = i.id and p.status = 'active'), 0)
        + coalesce((select sum(r.total) from ${salesReturns} r where r.invoice_id = i.id), 0)
      )::numeric(12, 2) as settled
      from ${invoices} i
      where i.id in ${invoiceIds}
    ) x
  `);
  return new Map(rows.map((r) => [r.id, { settled: r.settled, outstanding: r.outstanding }]));
}

export type OutstandingRow = {
  invoiceId: string;
  number: string;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  outstanding: string;
  daysOverdue: number;
};

/** Issued invoices with money still owed, earliest due first. Overdue = due before today (Colombo). */
export async function outstandingInvoices(
  filters: { customerId?: string; overdueOnly?: boolean } = {},
  tx: Executor = db,
): Promise<OutstandingRow[]> {
  const today = colomboDate();
  const rows = await tx.execute<{
    invoice_id: string;
    number: string;
    customer_id: string;
    customer_name: string;
    invoice_date: string;
    due_date: string;
    total: string;
    outstanding: string;
    days_overdue: number;
  }>(sql`
    select * from (
      select i.id as invoice_id, i.number, i.customer_id, c.name as customer_name,
             i.invoice_date::text, i.due_date::text, i.total::text,
             (i.total - least(i.total,
               coalesce((select sum(pa.amount) from ${paymentAllocations} pa
                         join ${payments} p on p.id = pa.payment_id
                         where pa.invoice_id = i.id and p.status = 'active'), 0)
               + coalesce((select sum(r.total) from ${salesReturns} r where r.invoice_id = i.id), 0)
             ))::numeric(12, 2)::text as outstanding,
             greatest(0, ${today}::date - i.due_date) as days_overdue
      from ${invoices} i
      join ${customers} c on c.id = i.customer_id
      where i.status = 'issued'
        ${filters.customerId ? sql`and i.customer_id = ${filters.customerId}` : sql``}
        ${filters.overdueOnly ? sql`and i.due_date < ${today}::date` : sql``}
    ) x
    where outstanding::numeric > 0
    order by due_date, invoice_date, number
  `);
  return rows.map((r) => ({
    invoiceId: r.invoice_id,
    number: r.number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    total: r.total,
    outstanding: r.outstanding,
    daysOverdue: Number(r.days_overdue),
  }));
}

export type StatementRow = {
  date: string;
  type: "INVOICE" | "PAYMENT" | "CREDIT_NOTE" | "REFUND";
  number: string;
  refId: string;
  debit: string;
  credit: string;
  balance: string;
};

/** Account statement: invoices and refunds are debits, payments and credit notes are credits. */
export async function customerStatement(
  customerId: string,
  from?: string,
  to?: string,
): Promise<{ opening: string; rows: StatementRow[]; closing: string }> {
  const entries = await db.execute<{
    type: StatementRow["type"];
    date: string;
    number: string;
    ref_id: string;
    debit: string;
    credit: string;
  }>(sql`
    select * from (
      select 'INVOICE' as type, i.invoice_date::text as date, i.number, i.id as ref_id,
             i.total::text as debit, '0.00' as credit, i.created_at
      from ${invoices} i where i.customer_id = ${customerId} and i.status = 'issued'
      union all
      select case when p.is_refund then 'REFUND' else 'PAYMENT' end, p.payment_date::text, p.number, p.id,
             case when p.is_refund then (-p.amount)::text else '0.00' end,
             case when p.is_refund then '0.00' else p.amount::text end, p.created_at
      from ${payments} p where p.customer_id = ${customerId} and p.status = 'active'
      union all
      select 'CREDIT_NOTE', r.return_date::text, r.number, r.id, '0.00', r.total::text, r.created_at
      from ${salesReturns} r where r.customer_id = ${customerId}
    ) x
    order by date, created_at
  `);

  let opening = D(0);
  let running = D(0);
  const rows: StatementRow[] = [];
  for (const e of entries) {
    if (to && e.date > to) continue;
    const change = D(e.debit).minus(e.credit);
    if (from && e.date < from) {
      opening = opening.plus(change);
      continue;
    }
    if (rows.length === 0) running = opening;
    running = running.plus(change);
    rows.push({
      date: e.date,
      type: e.type,
      number: e.number,
      refId: e.ref_id,
      debit: e.debit,
      credit: e.credit,
      balance: fmt(running),
    });
  }
  return { opening: fmt(opening), rows, closing: fmt(rows.length ? running : opening) };
}

async function defaultTierId(): Promise<string> {
  const [row] = await db.select({ id: priceTiers.id }).from(priceTiers).where(eq(priceTiers.isDefault, true));
  return row.id;
}

/** Staff may add customers, but only cash customers on the default tier (spec §6). */
export async function createCustomer(user: SessionUser, input: CustomerInput): Promise<{ id: string }> {
  const data = customerInputSchema.parse(input);
  if (user.role !== "admin") {
    if (data.creditLimit !== "0.00") throw new Forbidden("Only an admin can give a customer credit");
    if (data.tierId !== (await defaultTierId())) throw new Forbidden("Only an admin can set a customer's price tier");
  }
  const [row] = await db.insert(customers).values(data).returning({ id: customers.id });
  return row;
}

export const quickAddCustomerSchema = customerInputSchema.pick({
  name: true,
  phone: true,
  businessName: true,
  address: true,
});

export type QuickAddCustomerInput = z.input<typeof quickAddCustomerSchema>;

/**
 * Adds a customer from the invoice or quotation editor's picker: cash only, on the default tier,
 * so staff and admin get the same. Credit and tier are set later on the customer's page.
 */
export async function quickAddCustomer(user: SessionUser, input: QuickAddCustomerInput): Promise<CustomerRow> {
  const contact = quickAddCustomerSchema.parse(input);
  const [tierId, settings] = await Promise.all([defaultTierId(), getSettings()]);
  const { id } = await createCustomer(user, {
    ...contact,
    tierId,
    creditLimit: "0.00",
    creditDays: settings.defaultCreditDays,
    isActive: true,
  });
  return getCustomer(id);
}

/** Staff may edit contact details; tier and credit terms are admin-only. */
export async function updateCustomer(user: SessionUser, id: string, input: CustomerInput): Promise<void> {
  const data = customerInputSchema.parse(input);
  const [current] = await db.select().from(customers).where(eq(customers.id, id));
  if (!current) throw new NotFound("Customer not found");

  if (user.role !== "admin") {
    const termsChanged =
      data.tierId !== current.tierId ||
      data.creditLimit !== current.creditLimit ||
      data.creditDays !== current.creditDays;
    if (termsChanged) throw new Forbidden("Only an admin can change price tier or credit terms");
  }
  if (current.isWalkIn) {
    if (data.creditLimit !== "0.00") throw new InvalidState("The walk-in customer is cash only");
    if (!data.isActive) throw new InvalidState("The walk-in customer can't be turned off");
  }
  await db.update(customers).set(data).where(eq(customers.id, id));
}

export type CustomerRow = {
  id: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  address: string | null;
  tin: string | null;
  tierId: string;
  tierName: string;
  creditLimit: string;
  creditDays: number;
  isWalkIn: boolean;
  isActive: boolean;
};

const customerColumns = {
  id: customers.id,
  name: customers.name,
  businessName: customers.businessName,
  phone: customers.phone,
  address: customers.address,
  tin: customers.tin,
  tierId: customers.tierId,
  tierName: priceTiers.name,
  creditLimit: customers.creditLimit,
  creditDays: customers.creditDays,
  isWalkIn: customers.isWalkIn,
  isActive: customers.isActive,
};

export async function listCustomers(filters: { q?: string; activeOnly?: boolean; limit?: number } = {}): Promise<CustomerRow[]> {
  const where: SQL[] = [];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      sql`(${customers.name} ilike ${like} or ${customers.businessName} ilike ${like} or ${customers.phone} ilike ${like})`,
    );
  }
  if (filters.activeOnly) where.push(eq(customers.isActive, true));
  return db
    .select(customerColumns)
    .from(customers)
    .innerJoin(priceTiers, eq(priceTiers.id, customers.tierId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${customers.isWalkIn} desc`, asc(customers.name))
    .limit(filters.limit ?? 500);
}

export async function getCustomer(id: string): Promise<CustomerRow> {
  if (!z.uuid().safeParse(id).success) throw new NotFound("Customer not found");
  const [row] = await db
    .select(customerColumns)
    .from(customers)
    .innerJoin(priceTiers, eq(priceTiers.id, customers.tierId))
    .where(eq(customers.id, id));
  if (!row) throw new NotFound("Customer not found");
  return row;
}
