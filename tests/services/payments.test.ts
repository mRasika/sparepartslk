import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate, colomboYear } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { Forbidden, InvalidState } from "@/server/errors";
import {
  customerBalance,
  customerStatement,
  invoiceOutstanding,
  outstandingInvoices,
} from "@/server/services/customers";
import { createInvoice } from "@/server/services/invoicing";
import { receivePayment } from "@/server/services/payments";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser, tierIds } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;
const today = colomboDate();

async function creditInvoice(customerId: string, price: string, invoiceDate: string) {
  const tiers = await tierIds();
  const part = await makePart({ qty: 10, prices: [{ tierId: tiers.Retail, price }] });
  return createInvoice(admin, { customerId, paymentType: "credit", invoiceDate, lines: [{ partId: part.id, qty: 1 }] });
}

describe("payments", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  async function twoInvoices() {
    const customer = await makeCustomer({ creditLimit: "100000.00", creditDays: 30 });
    const older = await creditInvoice(customer.id, "1000.00", addDays(today, -10));
    const newer = await creditInvoice(customer.id, "500.00", today);
    return { customer, older, newer };
  }

  it("allocates oldest due first", async () => {
    const { customer, older, newer } = await twoInvoices();
    const pay = await receivePayment(staff, { customerId: customer.id, amount: "1200.00", method: "cash" });
    expect(pay.number).toBe(`PAY-${colomboYear()}-000001`);
    expect(pay.unapplied).toBe("0.00");
    const out = await invoiceOutstanding(db, [older.id, newer.id]);
    expect(out.get(older.id)).toEqual({ settled: "1000.00", outstanding: "0.00" });
    expect(out.get(newer.id)).toEqual({ settled: "200.00", outstanding: "300.00" });
  });

  it("keeps an overpayment as unapplied credit", async () => {
    const { customer } = await twoInvoices();
    const pay = await receivePayment(staff, { customerId: customer.id, amount: "2000.00", method: "bank", reference: "TT-889" });
    expect(pay.unapplied).toBe("500.00");
    expect(await customerBalance(db, customer.id)).toBe("-500.00");
  });

  it("requires a reference for cheques", async () => {
    const { customer } = await twoInvoices();
    const err = await receivePayment(staff, { customerId: customer.id, amount: "100.00", method: "cheque" }).catch((e) => e);
    expect(err.name).toBe("ZodError");
    expect(err.issues[0].path).toEqual(["reference"]);
  });

  it("forbids staff from allocating by hand", async () => {
    const { customer, newer } = await twoInvoices();
    await expect(
      receivePayment(staff, {
        customerId: customer.id,
        amount: "100.00",
        method: "cash",
        allocations: [{ invoiceId: newer.id, amount: "100.00" }],
      }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("lets an admin allocate by hand", async () => {
    const { customer, older, newer } = await twoInvoices();
    await receivePayment(admin, {
      customerId: customer.id,
      amount: "500.00",
      method: "cash",
      allocations: [{ invoiceId: newer.id, amount: "500.00" }],
    });
    const out = await invoiceOutstanding(db, [older.id, newer.id]);
    expect(out.get(newer.id)?.outstanding).toBe("0.00");
    expect(out.get(older.id)?.outstanding).toBe("1000.00");
  });

  it("rejects an allocation above the invoice's outstanding", async () => {
    const { customer, newer } = await twoInvoices();
    await expect(
      receivePayment(admin, {
        customerId: customer.id,
        amount: "900.00",
        method: "cash",
        allocations: [{ invoiceId: newer.id, amount: "600.00" }],
      }),
    ).rejects.toBeInstanceOf(InvalidState);
  });

  it("rejects allocations that add up to more than the payment", async () => {
    const { customer, older, newer } = await twoInvoices();
    await expect(
      receivePayment(admin, {
        customerId: customer.id,
        amount: "100.00",
        method: "cash",
        allocations: [
          { invoiceId: older.id, amount: "80.00" },
          { invoiceId: newer.id, amount: "80.00" },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidState);
  });

  it("lists overdue invoices: due yesterday yes, due today no", async () => {
    const customer = await makeCustomer({ creditLimit: "100000.00", creditDays: 30 });
    const late = await creditInvoice(customer.id, "100.00", addDays(today, -31));
    await creditInvoice(customer.id, "100.00", addDays(today, -30));
    const rows = await outstandingInvoices({ overdueOnly: true });
    expect(rows.map((r) => r.invoiceId)).toEqual([late.id]);
    expect(rows[0].daysOverdue).toBe(1);
    expect(await outstandingInvoices({ customerId: customer.id })).toHaveLength(2);
  });

  it("ends the statement at the customer's balance", async () => {
    const { customer } = await twoInvoices();
    await receivePayment(staff, { customerId: customer.id, amount: "700.00", method: "cash" });
    const statement = await customerStatement(customer.id);
    expect(statement.rows.map((r) => r.type)).toEqual(["INVOICE", "INVOICE", "PAYMENT"]);
    expect(statement.closing).toBe(await customerBalance(db, customer.id));
    expect(statement.closing).toBe("800.00");
  });

  it("carries earlier activity into the opening balance", async () => {
    const { customer } = await twoInvoices();
    const statement = await customerStatement(customer.id, addDays(today, -1));
    expect(statement.opening).toBe("1000.00");
    expect(statement.rows).toHaveLength(1);
    expect(statement.closing).toBe("1500.00");
  });
});
