import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { parts } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";
import { getDashboard, resolveReconciliationIssue } from "@/server/services/dashboard";
import { cancelInvoice, createInvoice } from "@/server/services/invoicing";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;
const today = colomboDate();

describe("dashboard", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("counts only today's issued invoices", async () => {
    const customer = await makeCustomer({ creditLimit: "100000.00" });
    const part = await makePart({ qty: 20 });
    const sell = (invoiceDate: string) =>
      createInvoice(admin, { customerId: customer.id, paymentType: "credit", invoiceDate, lines: [{ partId: part.id, qty: 1 }] });
    await sell(today);
    const cancelled = await sell(today);
    await sell(addDays(today, -1));
    await cancelInvoice(admin, cancelled.id, "test");
    const d = await getDashboard(staff);
    expect(d.todaySales).toBe("1000.00");
    expect(d.todayInvoiceCount).toBe(1);
  });

  it("splits what is owed from what is overdue", async () => {
    const customer = await makeCustomer({ creditLimit: "100000.00", creditDays: 30 });
    const part = await makePart({ qty: 20 });
    await createInvoice(admin, { customerId: customer.id, paymentType: "credit", invoiceDate: addDays(today, -40), lines: [{ partId: part.id, qty: 1 }] });
    await createInvoice(admin, { customerId: customer.id, paymentType: "credit", invoiceDate: today, lines: [{ partId: part.id, qty: 2 }] });
    const d = await getDashboard(admin);
    expect(d.totalOutstanding).toBe("3000.00");
    expect(d.totalOverdue).toBe("1000.00");
  });

  it("counts low stock", async () => {
    await makePart({ qty: 1, reorderLevel: 5 });
    await makePart({ qty: 9, reorderLevel: 5 });
    expect((await getDashboard(staff)).lowStockCount).toBe(1);
  });

  it("shows reconciliation issues to admins only", async () => {
    const part = await makePart({ sku: "DRIFT-9", qty: 4 });
    await db.update(parts).set({ qtyOnHand: sql`${parts.qtyOnHand} + 1` }).where(eq(parts.id, part.id));
    await db.execute(sql`select public.reconcile_stock()`);

    expect(await getDashboard(staff)).not.toHaveProperty("reconciliationIssues");
    const d = await getDashboard(admin);
    expect(d.reconciliationIssues).toHaveLength(1);
    expect(d.reconciliationIssues![0]).toMatchObject({ sku: "DRIFT-9", storedQty: 5, ledgerQty: 4 });

    await expect(resolveReconciliationIssue(staff, d.reconciliationIssues![0].id)).rejects.toBeInstanceOf(Forbidden);
    await resolveReconciliationIssue(admin, d.reconciliationIssues![0].id);
    expect((await getDashboard(admin)).reconciliationIssues).toHaveLength(0);
  });
});
