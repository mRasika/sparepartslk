import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadDemoData } from "../../scripts/demo-data";
import { db } from "@/server/db/client";
import { invoices, parts, payments, salesReturns } from "@/server/db/schema";
import { outstandingInvoices } from "@/server/services/customers";
import { getDashboard } from "@/server/services/dashboard";
import { lowStock } from "@/server/services/inventory";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

describe("demo data", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loads a consistent, realistic data set", async () => {
    const admin = await makeUser("admin");
    const staff = await makeUser("staff");
    const summary = await loadDemoData({ admin, staff });

    expect(summary.loaded).toBe(true);
    expect((await db.select().from(parts)).length).toBeGreaterThanOrEqual(25);
    expect((await db.select().from(invoices)).length).toBeGreaterThanOrEqual(12);
    expect((await db.select().from(payments)).length).toBeGreaterThanOrEqual(5);
    expect((await db.select().from(salesReturns)).length).toBeGreaterThanOrEqual(2);

    // Every stock change went through the ledger.
    const [check] = await db.execute<{ n: number }>(sql`select public.reconcile_stock() as n`);
    expect(check.n).toBe(0);

    expect((await lowStock()).length).toBeGreaterThanOrEqual(3);
    expect((await outstandingInvoices({ overdueOnly: true })).length).toBeGreaterThanOrEqual(1);
    const dash = await getDashboard(admin);
    expect(dash.todayInvoiceCount).toBeGreaterThanOrEqual(2);
  });

  it("refuses to load twice", async () => {
    const admin = await makeUser("admin");
    await loadDemoData({ admin, staff: admin });
    const again = await loadDemoData({ admin, staff: admin });
    expect(again.loaded).toBe(false);
  });
});
