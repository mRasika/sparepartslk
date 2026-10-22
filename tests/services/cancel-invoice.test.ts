import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { colomboYear } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { invoices, parts, payments, stockMovements } from "@/server/db/schema";
import { Forbidden, InvalidState } from "@/server/errors";
import { customerBalance } from "@/server/services/customers";
import { cancelInvoice, createInvoice } from "@/server/services/invoicing";
import { receivePayment } from "@/server/services/payments";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;

describe("cancelInvoice", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("restores stock, records SALE_CANCEL and clears the balance", async () => {
    const customer = await makeCustomer({ creditLimit: "100000.00" });
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "credit", lines: [{ partId: part.id, qty: 3 }] });
    expect(await customerBalance(db, customer.id)).toBe("3000.00");

    await cancelInvoice(admin, inv.id, "Wrong customer");

    const [p] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(p.qtyOnHand).toBe(10);
    expect(p.avgCost).toBe("600.00");
    const ms = await db.select().from(stockMovements).where(eq(stockMovements.refId, inv.id));
    expect(ms.map((m) => [m.type, m.qtyChange])).toEqual([
      ["SALE", -3],
      ["SALE_CANCEL", 3],
    ]);
    const [header] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(header).toMatchObject({ status: "cancelled", cancelReason: "Wrong customer", cancelledBy: admin.id });
    expect(header.cancelledAt).toBeInstanceOf(Date);
    expect(await customerBalance(db, customer.id)).toBe("0.00");

    const next = await createInvoice(staff, { customerId: customer.id, paymentType: "credit", lines: [{ partId: part.id, qty: 1 }] });
    expect(next.number).toBe(`INV-${colomboYear()}-000002`);
  });

  it("cancels a cash invoice's own payment too", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    await cancelInvoice(admin, inv.id, "Customer changed mind");
    const [pay] = await db.select().from(payments).where(eq(payments.invoiceId, inv.id));
    expect(pay.status).toBe("cancelled");
    expect(await customerBalance(db, customer.id)).toBe("0.00");
  });

  it("refuses when another payment is allocated to the invoice", async () => {
    const customer = await makeCustomer({ creditLimit: "100000.00" });
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "credit", lines: [{ partId: part.id, qty: 1 }] });
    await receivePayment(staff, { customerId: customer.id, amount: "100.00", method: "cash" });
    await expect(cancelInvoice(admin, inv.id, "Oops")).rejects.toBeInstanceOf(InvalidState);
  });

  it("refuses to cancel twice", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    await cancelInvoice(admin, inv.id, "First");
    await expect(cancelInvoice(admin, inv.id, "Second")).rejects.toBeInstanceOf(InvalidState);
  });

  it("is admin only", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    await expect(cancelInvoice(staff, inv.id, "Nope")).rejects.toBeInstanceOf(Forbidden);
  });

  it("requires a reason", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    const err = await cancelInvoice(admin, inv.id, "   ").catch((e) => e);
    expect(err.name).toBe("ZodError");
  });
});
