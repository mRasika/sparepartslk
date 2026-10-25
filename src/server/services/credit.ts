import { sql } from "drizzle-orm";
import { summarizeCredit, type CreditSummary, type CustomerFacts } from "@/lib/aging";
import { addDays, colomboDate } from "@/lib/dates";
import { db } from "@/server/db/client";
import { outstandingInvoices } from "@/server/services/customers";

/**
 * Who owes what and how late, for Payments › Outstanding (spec §3). Reuses outstandingInvoices()
 * so "owed" always matches the invoice list. Holds no cost or profit, so staff may see it.
 */
export async function getCreditSummary(by: "owed" | "overdue" = "owed", today: string = colomboDate()): Promise<CreditSummary> {
  const [open, facts, [sales]] = await Promise.all([
    outstandingInvoices(),
    // Every customer with something owed or paid ahead: balance = issued − active payments − credit notes.
    db.execute<{ id: string; name: string; credit_limit: string; balance: string; last_paid: string | null }>(sql`
      select id, name, credit_limit::text, balance::text, last_paid
      from (
        select c.id, c.name, c.credit_limit,
               (coalesce((select sum(i.total) from invoices i where i.customer_id = c.id and i.status = 'issued'), 0)
                - coalesce((select sum(p.amount) from payments p where p.customer_id = c.id and p.status = 'active'), 0)
                - coalesce((select sum(r.total) from sales_returns r where r.customer_id = c.id), 0)
               )::numeric(12, 2) as balance,
               (select max(p.payment_date)::text from payments p
                 where p.customer_id = c.id and p.status = 'active' and not p.is_refund) as last_paid
        from customers c
      ) x
      where balance <> 0
    `),
    db.execute<{ total: string }>(sql`
      select coalesce(sum(total), 0)::numeric(12, 2)::text as total
      from invoices
      where status = 'issued' and payment_type = 'credit'
        and invoice_date between ${addDays(today, -89)}::date and ${today}::date
    `),
  ]);

  const customers: CustomerFacts[] = facts.map((f) => ({
    customerId: f.id,
    name: f.name,
    creditLimit: f.credit_limit,
    balance: f.balance,
    lastPaidOn: f.last_paid,
  }));
  // A customer can owe on invoices while their balance nets to 0 (an unmatched payment): add their facts.
  const missing = [...new Set(open.map((o) => o.customerId))].filter((id) => !customers.some((c) => c.customerId === id));
  if (missing.length) {
    const rows = await db.execute<{ id: string; name: string; credit_limit: string; last_paid: string | null }>(sql`
      select c.id, c.name, c.credit_limit::text,
             (select max(p.payment_date)::text from payments p
               where p.customer_id = c.id and p.status = 'active' and not p.is_refund) as last_paid
      from customers c where c.id in ${missing}
    `);
    customers.push(...rows.map((r) => ({ customerId: r.id, name: r.name, creditLimit: r.credit_limit, balance: "0.00", lastPaidOn: r.last_paid })));
  }

  return summarizeCredit(
    {
      today,
      open: open.map((o) => ({
        invoiceId: o.invoiceId,
        customerId: o.customerId,
        customerName: o.customerName,
        dueDate: o.dueDate,
        outstanding: o.outstanding,
      })),
      customers,
      creditSales90: sales.total,
    },
    by,
  );
}
