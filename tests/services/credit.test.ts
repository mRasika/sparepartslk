import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate } from "@/lib/dates";
import { D, fmt, sum } from "@/lib/money";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { invoiceItems } from "@/server/db/schema";
import { getCreditSummary } from "@/server/services/credit";
import { outstandingInvoices } from "@/server/services/customers";
import { cancelInvoice, createInvoice } from "@/server/services/invoicing";
import { receivePayment } from "@/server/services/payments";
import { createReturn } from "@/server/services/returns";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let partId: string;
const today = colomboDate();

async function creditSale(customerId: string, qty: number, invoiceDate = today) {
  return createInvoice(admin, { customerId, paymentType: "credit", invoiceDate, lines: [{ partId, qty }] });
}

function pay(customerId: string, amount: string) {
  return receivePayment(admin, { customerId, amount, method: "cash" });
}

describe("getCreditSummary", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    partId = (await makePart({ qty: 50, avgCost: "600.00" })).id;
  });

  it("matches the outstanding list and ages it", async () => {
    const x = await makeCustomer({ name: "X", creditLimit: "100000.00" });
    const y = await makeCustomer({ name: "Y", creditLimit: "100000.00" });
    const late = await creditSale(x.id, 2, addDays(today, -40)); // due today − 10
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, late.id));
    await createReturn(admin, { invoiceId: late.id, reason: "Wrong part", lines: [{ invoiceItemId: item.id, qty: 1, restock: true }] });
    await creditSale(y.id, 2);
    await pay(y.id, "500.00");
    await cancelInvoice(admin, (await creditSale(y.id, 1)).id, "test");

    const s = await getCreditSummary();
    const listed = fmt(sum((await outstandingInvoices()).map((r) => D(r.outstanding))));
    expect(s.owed).toBe(listed);
    expect(s.owed).toBe("2500.00");
    expect(s.groups.find((g) => g.key === "1-30")?.amount).toBe("1000.00");
    expect(s.groups.find((g) => g.key === "not-due")?.amount).toBe("1500.00");
    expect(s.customers.find((c) => c.name === "X")).toMatchObject({ overdue: "1000.00", oldestDaysLate: 10, lastPaidOn: null });
    expect(s.customers.find((c) => c.name === "Y")).toMatchObject({ overdue: "0.00", lastPaidOn: today });
    expect(s.unappliedCredit).toBe("0.00");
  });

  it("counts prepaid money for a customer with nothing open", async () => {
    const z = await makeCustomer({ name: "Z", creditLimit: "100000.00" });
    await creditSale(z.id, 1);
    await pay(z.id, "1500.00");

    const s = await getCreditSummary();
    expect(s.customers.find((c) => c.name === "Z")).toBeUndefined();
    expect(s.unappliedCredit).toBe("500.00");
  });

  it("lists a customer whose unmatched payment nets their balance to zero", async () => {
    const v = await makeCustomer({ name: "V", creditLimit: "5000.00" });
    await creditSale(v.id, 1);
    await receivePayment(admin, { customerId: v.id, amount: "1000.00", method: "cash", allocations: [] });

    const s = await getCreditSummary();
    expect(s.customers.find((c) => c.name === "V")).toMatchObject({ owed: "1000.00", limitUsedPct: 0, overLimit: false, lastPaidOn: today });
    expect(s.unappliedCredit).toBe("1000.00");
  });

  it("computes DSO from 90 days of credit sales", async () => {
    const y = await makeCustomer({ name: "Y", creditLimit: "100000.00" });
    await creditSale(y.id, 2);
    await pay(y.id, "500.00");
    expect((await getCreditSummary()).dso).toBe(68); // 1500 / 2000 × 90 = 67.5

    // A paid credit invoice 90 days ago, for someone else, is outside the window.
    const w = await makeCustomer({ name: "W", creditLimit: "100000.00" });
    await creditSale(w.id, 1, addDays(today, -90));
    await pay(w.id, "1000.00");
    expect((await getCreditSummary()).dso).toBe(68);
  });
});
