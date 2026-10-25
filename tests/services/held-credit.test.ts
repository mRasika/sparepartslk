import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { InvalidState } from "@/server/errors";
import { getCreditSummary } from "@/server/services/credit";
import { outstandingInvoices } from "@/server/services/customers";
import { cancelInvoice, createInvoice } from "@/server/services/invoicing";
import { listPayments, receivePayment } from "@/server/services/payments";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let partId: string;
let customerId: string;
const today = colomboDate();

/** Part price is Rs 1,000, so qty is the invoice total in thousands. */
function sale(qty: number, paymentType: "credit" | "cash" = "credit", invoiceDate = today) {
  return createInvoice(admin, { customerId, paymentType, invoiceDate, lines: [{ partId, qty }] });
}

/** A payment kept entirely as credit (admin, no allocations). */
function holdCredit(amount: string) {
  return receivePayment(admin, { customerId, amount, method: "cash", allocations: [] });
}

async function owedOn(invoiceId: string) {
  return (await outstandingInvoices({ customerId })).find((r) => r.invoiceId === invoiceId)?.outstanding ?? "0.00";
}

const held = async () => (await getCreditSummary()).unappliedCredit;

describe("held credit", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    partId = (await makePart({ qty: 50, avgCost: "600.00" })).id;
    customerId = (await makeCustomer({ creditLimit: "100000.00" })).id;
  });

  it("goes onto a new credit invoice", async () => {
    await holdCredit("500.00");
    const inv = await sale(2);
    expect(await owedOn(inv.id)).toBe("1500.00");
    expect(await held()).toBe("0.00");
  });

  it("covers a new invoice in full and keeps the rest", async () => {
    await holdCredit("3000.00");
    const a = await sale(1);
    const b = await sale(1);
    expect(await owedOn(a.id)).toBe("0.00");
    expect(await owedOn(b.id)).toBe("0.00");
    expect(await held()).toBe("1000.00");
  });

  it("leaves cash invoices alone", async () => {
    await holdCredit("500.00");
    const inv = await sale(1, "cash");
    expect(await owedOn(inv.id)).toBe("0.00");
    expect(await held()).toBe("500.00");
  });

  it("settles open invoices oldest due first when run for a customer", async () => {
    const older = await sale(1, "credit", addDays(today, -20));
    const newer = await sale(2, "credit", addDays(today, -5));
    await holdCredit("1500.00");
    await db.execute(sql`select public.apply_held_credit(${customerId})`);
    expect(await owedOn(older.id)).toBe("0.00");
    expect(await owedOn(newer.id)).toBe("1500.00");
  });

  it("goes back to the account, and onto other open invoices, when its invoice is cancelled", async () => {
    await holdCredit("1000.00");
    const covered = await sale(1);
    const open = await sale(1);
    expect(await owedOn(open.id)).toBe("1000.00");

    await cancelInvoice(admin, covered.id, "Wrong customer");
    expect(await owedOn(open.id)).toBe("0.00");
    expect(await held()).toBe("0.00");
  });

  it("shows a payment as unapplied again once the invoice it paid is cancelled", async () => {
    const pay = await holdCredit("1000.00");
    const covered = await sale(1);
    await cancelInvoice(admin, covered.id, "Wrong customer");
    const row = (await listPayments({ customerId })).find((p) => p.id === pay.id);
    expect(row?.allocated).toBe("0.00");
    expect(await held()).toBe("1000.00");
  });

  it("still blocks cancelling an invoice paid by a payment made for it", async () => {
    const inv = await sale(1);
    await receivePayment(admin, { customerId, amount: "1000.00", method: "cash" });
    await expect(cancelInvoice(admin, inv.id, "test")).rejects.toThrow(InvalidState);
  });
});
