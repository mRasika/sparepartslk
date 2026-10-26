import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { addDays, colomboDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { closedDays, invoiceItems, salesTargets, settings } from "@/server/db/schema";
import { Forbidden, InvalidState, NotFound } from "@/server/errors";
import { cancelInvoice, createInvoice, type InvoiceInput } from "@/server/services/invoicing";
import { receivePayment } from "@/server/services/payments";
import { createReturn } from "@/server/services/returns";
import {
  addClosedDay,
  getDailyTargetReport,
  getTargetSettings,
  removeClosedDay,
  saveSalesTarget,
} from "@/server/services/sales-targets";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;
let customerId: string;
const today = colomboDate();

/** An admin invoice (so it can be back-dated) for the shared credit customer. */
function sell(input: Partial<InvoiceInput> & Pick<InvoiceInput, "lines">) {
  return createInvoice(admin, { customerId, paymentType: "credit", ...input });
}

function insertTarget(effectiveFrom: string, dailyTarget: string, closedWeekdays: number[] = []) {
  return db.insert(salesTargets).values({ effectiveFrom, dailyTarget, closedWeekdays, createdBy: admin.id });
}

describe("sales targets", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
    customerId = (await makeCustomer({ creditLimit: "10000000.00" })).id;
  });

  it("refuses staff", async () => {
    const input = { dailyTarget: "250000", closedWeekdays: [] };
    await expect(getTargetSettings(staff)).rejects.toBeInstanceOf(Forbidden);
    await expect(saveSalesTarget(staff, input)).rejects.toBeInstanceOf(Forbidden);
    await expect(addClosedDay(staff, { day: addDays(today, 1) })).rejects.toBeInstanceOf(Forbidden);
    await expect(removeClosedDay(staff, addDays(today, 1))).rejects.toBeInstanceOf(Forbidden);
    await expect(getDailyTargetReport(staff, today)).rejects.toBeInstanceOf(Forbidden);
  });

  it("saving twice on one day keeps one row", async () => {
    await saveSalesTarget(admin, { dailyTarget: "250000", closedWeekdays: [7] });
    await saveSalesTarget(admin, { dailyTarget: "300000", closedWeekdays: [] });
    expect(await db.$count(salesTargets)).toBe(1);
    const s = await getTargetSettings(admin);
    expect(s.current).toMatchObject({ effectiveFrom: today, dailyTarget: "300000.00", closedWeekdays: [] });
    expect(s.previous).toBeNull();
  });

  it("a later target leaves earlier days unchanged", async () => {
    await insertTarget(addDays(today, -10), "250000.00");
    await saveSalesTarget(admin, { dailyTarget: "300000", closedWeekdays: [] });
    const part = await makePart({ qty: 500 });
    const soldOn = addDays(today, -3);
    await sell({ invoiceDate: soldOn, lines: [{ partId: part.id, qty: 260 }] });

    const report = await getDailyTargetReport(admin, soldOn);
    expect(report.day).toMatchObject({ netSales: "260000.00", target: "250000.00", status: "hit" });
    expect((await getTargetSettings(admin)).previous?.dailyTarget).toBe("250000.00");
  });

  it("rejects a zero target and seven closed weekdays", async () => {
    await expect(saveSalesTarget(admin, { dailyTarget: "0", closedWeekdays: [] })).rejects.toBeInstanceOf(ZodError);
    await expect(
      saveSalesTarget(admin, { dailyTarget: "250000", closedWeekdays: [1, 2, 3, 4, 5, 6, 7] }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("enforces the closed date rules", async () => {
    const tomorrow = addDays(today, 1);
    await expect(addClosedDay(admin, { day: addDays(today, -1) })).rejects.toThrow("Closed dates can't be in the past");
    await addClosedDay(admin, { day: tomorrow, reason: "Vesak Poya" });
    await expect(addClosedDay(admin, { day: tomorrow })).rejects.toThrow("is already closed");
    expect((await getTargetSettings(admin)).closedDays).toEqual([{ day: tomorrow, reason: "Vesak Poya" }]);

    await db.insert(closedDays).values({ day: addDays(today, -2), createdBy: admin.id });
    await expect(removeClosedDay(admin, addDays(today, -2))).rejects.toThrow("Past closed dates can't be removed");
    await expect(removeClosedDay(admin, addDays(today, 5))).rejects.toBeInstanceOf(NotFound);

    await removeClosedDay(admin, tomorrow);
    expect((await getTargetSettings(admin)).closedDays).toEqual([]);
  });

  it("adds up the day", async () => {
    await db.update(settings).set({ vatEnabled: true, vatRate: "18.00" });
    const part = await makePart({ qty: 50 });
    await sell({ paymentType: "cash", lines: [{ partId: part.id, qty: 2 }] });
    const credit = await sell({ lines: [{ partId: part.id, qty: 1 }] });
    const cancelled = await sell({ lines: [{ partId: part.id, qty: 1 }] });
    await cancelInvoice(admin, cancelled.id, "test");
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, credit.id));
    await createReturn(admin, {
      invoiceId: credit.id,
      reason: "Wrong part",
      lines: [{ invoiceItemId: item.id, qty: 1, restock: true }],
    });
    await receivePayment(admin, { customerId, amount: "500.00", method: "cash" });

    const { day } = await getDailyTargetReport(admin, today);
    expect(day).toMatchObject({
      netSales: "2000.00",
      invoiceCount: 2,
      avgSale: "1500.00",
      cashSales: "2000.00",
      creditSales: "1000.00",
      collected: "2860.00",
      target: null,
      status: "no-target",
    });
  });

  it("takes cash refunds off the money collected", async () => {
    const part = await makePart({ qty: 50 });
    const cash = await sell({ paymentType: "cash", lines: [{ partId: part.id, qty: 2 }] });
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, cash.id));
    await createReturn(admin, {
      invoiceId: cash.id,
      reason: "Wrong part",
      lines: [{ invoiceItemId: item.id, qty: 1, restock: true }],
      refund: { method: "cash" },
    });

    const { day } = await getDailyTargetReport(admin, today);
    expect(day.netSales).toBe("1000.00");
    expect(day.collected).toBe("1000.00");
  });

  it("compares with the same weekday last week", async () => {
    const part = await makePart({ qty: 50 });
    await sell({ invoiceDate: addDays(today, -7), lines: [{ partId: part.id, qty: 3 }] });
    expect((await getDailyTargetReport(admin, today)).day.lastWeekSales).toBe("3000.00");
  });

  it("reports an earlier month as of its date", async () => {
    await insertTarget(addDays(today, -90), "250000.00");
    const lastMonth = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const first = lastMonth.toISOString().slice(0, 10);
    const tenth = `${first.slice(0, 8)}10`;
    const length = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 0)).getUTCDate();

    const { day, month } = await getDailyTargetReport(admin, tenth);
    expect(month.days[0].date).toBe(first);
    expect(month.days).toHaveLength(length);
    expect(month.tradingDaysLeft).toBe(length - 10);
    expect(day.status).toBe("missed");
    expect(month.outcome).toBe("open");
  });

  it("rejects a future date", async () => {
    await expect(getDailyTargetReport(admin, addDays(today, 1))).rejects.toBeInstanceOf(InvalidState);
  });
});
