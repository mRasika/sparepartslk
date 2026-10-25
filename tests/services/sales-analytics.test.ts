import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { brands, categories, invoiceItems, settings, vehicleModels } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";
import { cancelInvoice, createInvoice, type InvoiceInput } from "@/server/services/invoicing";
import { createReturn } from "@/server/services/returns";
import { resolvePeriod } from "@/lib/periods";
import { getSalesAnalytics, getSalesTotals, getSalesTrend, getTopSellers } from "@/server/services/sales-analytics";
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

describe("sales analytics: top sellers", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    customerId = (await makeCustomer({ creditLimit: "1000000.00" })).id;
  });

  it("shares the invoice discount across lines", async () => {
    const a = await makePart({ qty: 10 });
    const b = await makePart({ qty: 10 });
    await sell({
      lines: [{ partId: a.id, qty: 1 }, { partId: b.id, qty: 1 }],
      invoiceDiscount: { type: "amount", value: "200" },
    });

    const rows = await getTopSellers(todayOnly, "parts", "sales");
    expect(rows.map((r) => [r.detail, r.netSales])).toEqual(
      expect.arrayContaining([[a.sku, "900.00"], [b.sku, "900.00"]]),
    );
    expect((await getSalesTotals(todayOnly)).netSales).toBe("1800.00");
  });

  it("subtracts returned quantities", async () => {
    const a = await makePart({ qty: 10 });
    const inv = await sell({ lines: [{ partId: a.id, qty: 3 }] });
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
    await createReturn(admin, { invoiceId: inv.id, reason: "Wrong size", lines: [{ invoiceItemId: item.id, qty: 1, restock: true }] });

    expect(await getTopSellers(todayOnly, "parts", "sales")).toMatchObject([{ key: a.id, qty: 2, netSales: "2000.00" }]);
  });

  it("groups missing category and brand", async () => {
    const [brakes] = await db.insert(categories).values({ name: "Brakes" }).returning();
    const [honda] = await db.insert(brands).values({ name: "Honda" }).returning();
    const plain = await makePart({ qty: 10 });
    const branded = await makePart({ qty: 10, categoryId: brakes.id, brandId: honda.id });
    await sell({ lines: [{ partId: plain.id, qty: 1 }, { partId: branded.id, qty: 2 }] });

    expect(await getTopSellers(todayOnly, "categories", "sales")).toMatchObject([
      { key: brakes.id, name: "Brakes", netSales: "2000.00" },
      { key: "none", name: "Uncategorised", netSales: "1000.00" },
    ]);
    expect(await getTopSellers(todayOnly, "brands", "sales")).toMatchObject([
      { name: "Honda", netSales: "2000.00" },
      { name: "No brand", netSales: "1000.00" },
    ]);
  });

  it("counts a part toward every bike model it fits, and skips parts with none", async () => {
    const models = await db
      .insert(vehicleModels)
      .values([{ make: "Bajaj", model: "CT100" }, { make: "Honda", model: "Dio" }])
      .returning();
    const fits = await makePart({ qty: 10, fitmentIds: models.map((m) => m.id) });
    const none = await makePart({ qty: 10 });
    await sell({ lines: [{ partId: fits.id, qty: 1 }, { partId: none.id, qty: 1 }] });

    const rows = await getTopSellers(todayOnly, "models", "sales");
    expect(rows.map((r) => [r.name, r.netSales])).toEqual([
      ["Bajaj CT100", "1000.00"],
      ["Honda Dio", "1000.00"],
    ]);
  });

  it("sorts by sales or by profit", async () => {
    const x = await makePart({ qty: 10, avgCost: "900.00" });
    const y = await makePart({ qty: 10, avgCost: "100.00" });
    await sell({ lines: [{ partId: x.id, qty: 2 }, { partId: y.id, qty: 1 }] });

    expect((await getTopSellers(todayOnly, "parts", "sales"))[0].key).toBe(x.id);
    const byProfit = await getTopSellers(todayOnly, "parts", "profit");
    expect(byProfit[0]).toMatchObject({ key: y.id, grossProfit: "900.00" });
  });

  it("sorts amounts as numbers, not text", async () => {
    const big = await makePart({ qty: 20 });
    const small = await makePart({ qty: 20 });
    await sell({ lines: [{ partId: big.id, qty: 10 }, { partId: small.id, qty: 9 }] });

    // As text "9000.00" sorts above "10000.00".
    expect((await getTopSellers(todayOnly, "parts", "sales")).map((r) => r.netSales)).toEqual(["10000.00", "9000.00"]);
    expect((await getTopSellers(todayOnly, "parts", "profit")).map((r) => r.netSales)).toEqual(["10000.00", "9000.00"]);
  });

  it("limits to 10 rows", async () => {
    const parts = await Promise.all(Array.from({ length: 11 }, () => makePart({ qty: 10 })));
    await sell({ lines: parts.map((p) => ({ partId: p.id, qty: 1 })) });

    expect(await getTopSellers(todayOnly, "parts", "sales")).toHaveLength(10);
  });

  it("refuses staff", async () => {
    const staff = await makeUser("staff");
    await expect(getSalesAnalytics(staff, resolvePeriod({}), { dimension: "parts", sort: "sales" })).rejects.toThrow(Forbidden);
  });

  it("returns current, previous, trend and top for admins", async () => {
    const period = resolvePeriod({ period: "week" });
    const part = await makePart({ qty: 10 });
    await sell({ lines: [{ partId: part.id, qty: 1 }] });
    await sell({ invoiceDate: period.compare.from, lines: [{ partId: part.id, qty: 1 }] });

    const a = await getSalesAnalytics(admin, period, { dimension: "parts", sort: "sales" });
    expect(a.current.invoiceCount).toBe(1);
    expect(a.previous.invoiceCount).toBe(1);
    expect(a.trend[0].bucketStart).toBe(period.range.from);
    expect(a.trend.at(-1)?.bucketStart).toBe(today);
    expect(a.top).toHaveLength(1);
  });
});
