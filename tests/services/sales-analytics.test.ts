import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { invoiceItems, settings } from "@/server/db/schema";
import { cancelInvoice, createInvoice, type InvoiceInput } from "@/server/services/invoicing";
import { createReturn } from "@/server/services/returns";
import { getSalesTotals, getSalesTrend } from "@/server/services/sales-analytics";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let customerId: string;
const today = colomboDate();
const todayOnly = { from: today, to: today };

/** An admin invoice (so it can be back-dated) for the shared credit customer. */
function sell(input: Partial<InvoiceInput> & Pick<InvoiceInput, "lines">) {
  return createInvoice(admin, { customerId, paymentType: "credit", ...input });
}

describe("sales analytics: totals and trend", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    customerId = (await makeCustomer({ creditLimit: "1000000.00" })).id;
  });

  it("excludes cancelled invoices and VAT", async () => {
    await db.update(settings).set({ vatEnabled: true, vatRate: "18.00" });
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    await sell({ paymentType: "cash", lines: [{ partId: part.id, qty: 2 }] });
    const cancelled = await sell({ lines: [{ partId: part.id, qty: 1 }] });
    await cancelInvoice(admin, cancelled.id, "test");

    expect(await getSalesTotals(todayOnly)).toEqual({
      netSales: "2000.00",
      cost: "1200.00",
      grossProfit: "800.00",
      invoiceSales: "2000.00",
      invoiceCount: 1,
      cashSales: "2000.00",
      creditSales: "0.00",
    });
  });

  it("takes off the invoice discount", async () => {
    const part = await makePart({ qty: 10 });
    await sell({ lines: [{ partId: part.id, qty: 3 }], invoiceDiscount: { type: "amount", value: "300" } });

    const t = await getSalesTotals(todayOnly);
    expect(t.netSales).toBe("2700.00");
    expect(t.creditSales).toBe("2700.00");
  });

  it("counts a return on its own date", async () => {
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    const soldOn = addDays(today, -40);
    const inv = await sell({ invoiceDate: soldOn, lines: [{ partId: part.id, qty: 4 }] });
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
    await createReturn(admin, { invoiceId: inv.id, reason: "Wrong size", lines: [{ invoiceItemId: item.id, qty: 1, restock: true }] });
    await createReturn(admin, { invoiceId: inv.id, reason: "Damaged", lines: [{ invoiceItemId: item.id, qty: 1, restock: false }] });

    expect(await getSalesTotals({ from: soldOn, to: soldOn })).toMatchObject({ netSales: "4000.00", cost: "2400.00" });
    expect(await getSalesTotals(todayOnly)).toMatchObject({
      netSales: "-2000.00",
      cost: "-600.00",
      grossProfit: "-1400.00",
      invoiceCount: 0,
    });
  });

  it("handles a zero-subtotal invoice", async () => {
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    await sell({ lines: [{ partId: part.id, qty: 1 }], invoiceDiscount: { type: "percent", value: "100" } });

    expect(await getSalesTotals(todayOnly)).toMatchObject({ netSales: "0.00", cost: "600.00", grossProfit: "-600.00" });
  });

  it("fills empty days with zero", async () => {
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    await sell({ lines: [{ partId: part.id, qty: 1 }] });

    const points = await getSalesTrend({ from: addDays(today, -2), to: today }, "day");
    expect(points).toEqual([
      { bucketStart: addDays(today, -2), netSales: "0.00", grossProfit: "0.00" },
      { bucketStart: addDays(today, -1), netSales: "0.00", grossProfit: "0.00" },
      { bucketStart: today, netSales: "1000.00", grossProfit: "400.00" },
    ]);
  });

  it("starts weekly buckets on Monday but not before the range", async () => {
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const wednesday = addDays(today, -weekday + 2 - 14);
    const points = await getSalesTrend({ from: wednesday, to: addDays(wednesday, 7) }, "week");
    expect(points.map((p) => p.bucketStart)).toEqual([wednesday, addDays(wednesday, 5)]);
  });

  it("groups by month", async () => {
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    const d = new Date(`${today}T00:00:00Z`);
    const lastMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    const thisMonth = `${today.slice(0, 8)}01`;
    await sell({ invoiceDate: lastMonth, lines: [{ partId: part.id, qty: 1 }] });
    await sell({ invoiceDate: today, lines: [{ partId: part.id, qty: 2 }] });

    expect(await getSalesTrend({ from: lastMonth, to: today }, "month")).toEqual([
      { bucketStart: lastMonth, netSales: "1000.00", grossProfit: "400.00" },
      { bucketStart: thisMonth, netSales: "2000.00", grossProfit: "800.00" },
    ]);
  });
});
