import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { colomboDate } from "@/lib/dates";
import { D, fmt, sum } from "@/lib/money";
import { requireRole, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { invoices, parts, stockReconciliationIssues } from "@/server/db/schema";
import { NotFound } from "@/server/errors";
import { outstandingInvoices } from "@/server/services/customers";
import { lowStockCount } from "@/server/services/inventory";

export type ReconciliationIssue = {
  id: string;
  partId: string;
  sku: string;
  storedQty: number;
  ledgerQty: number;
  detectedAt: Date;
};

export type Dashboard = {
  todaySales: string;
  todayInvoiceCount: number;
  lowStockCount: number;
  totalOutstanding: string;
  totalOverdue: string;
  reconciliationIssues?: ReconciliationIssue[];
};

/** The day at a glance (spec §3.10). Reconciliation issues are for admins only. */
export async function getDashboard(user: SessionUser): Promise<Dashboard> {
  const today = colomboDate();
  const [[sales], low, open] = await Promise.all([
    db
      .select({
        total: sql<string>`coalesce(sum(${invoices.total}), 0)::numeric(12, 2)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(eq(invoices.invoiceDate, today), eq(invoices.status, "issued"))),
    lowStockCount(),
    outstandingInvoices(),
  ]);

  const dashboard: Dashboard = {
    todaySales: sales.total,
    todayInvoiceCount: sales.count,
    lowStockCount: low,
    totalOutstanding: fmt(sum(open.map((o) => D(o.outstanding)))),
    totalOverdue: fmt(sum(open.filter((o) => o.daysOverdue > 0).map((o) => D(o.outstanding)))),
  };
  if (user.role === "admin") {
    dashboard.reconciliationIssues = await db
      .select({
        id: stockReconciliationIssues.id,
        partId: stockReconciliationIssues.partId,
        sku: parts.sku,
        storedQty: stockReconciliationIssues.storedQty,
        ledgerQty: stockReconciliationIssues.ledgerQty,
        detectedAt: stockReconciliationIssues.detectedAt,
      })
      .from(stockReconciliationIssues)
      .innerJoin(parts, eq(parts.id, stockReconciliationIssues.partId))
      .where(isNull(stockReconciliationIssues.resolvedAt))
      .orderBy(asc(stockReconciliationIssues.detectedAt));
  }
  return dashboard;
}

/** Marks a mismatch as dealt with (after the admin fixes stock with a count correction). */
export async function resolveReconciliationIssue(user: SessionUser, issueId: string): Promise<void> {
  requireRole(user, "admin");
  const rows = await db
    .update(stockReconciliationIssues)
    .set({ resolvedAt: new Date() })
    .where(and(eq(stockReconciliationIssues.id, issueId), isNull(stockReconciliationIssues.resolvedAt)))
    .returning({ id: stockReconciliationIssues.id });
  if (!rows.length) throw new NotFound("Issue not found or already resolved");
}
