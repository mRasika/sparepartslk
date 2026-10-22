import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { colomboYear } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers, invoiceItems, parts, payments, settings, stockMovements } from "@/server/db/schema";
import { InvalidState, ReturnQtyExceeded } from "@/server/errors";
import { customerBalance, customerStatement, invoiceOutstanding } from "@/server/services/customers";
import { cancelInvoice, createInvoice } from "@/server/services/invoicing";
import { createReturn } from "@/server/services/returns";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser, tierIds } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;

async function qtyOf(partId: string) {
  const [p] = await db.select().from(parts).where(eq(parts.id, partId));
  return p.qtyOnHand;
}

async function sell(qty: number, opts: { customerId?: string; paymentType?: "cash" | "credit" } = {}) {
  const customer = opts.customerId ? { id: opts.customerId } : await makeCustomer({ creditLimit: "100000.00" });
  const part = await makePart({ qty: 10, avgCost: "400.00" });
  const inv = await createInvoice(staff, {
    customerId: customer.id,
    paymentType: opts.paymentType ?? "credit",
    lines: [{ partId: part.id, qty }],
  });
  const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
  return { customerId: customer.id, part, inv, item };
}

describe("createReturn", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("restocks, numbers the credit note and reduces what is owed", async () => {
    const { customerId, part, inv, item } = await sell(5);
    expect(await qtyOf(part.id)).toBe(5);
    const ret = await createReturn(staff, {
      invoiceId: inv.id,
      reason: "Wrong size",
      lines: [{ invoiceItemId: item.id, qty: 2, restock: true }],
    });
    expect(ret.number).toBe(`CRN-${colomboYear()}-000001`);
    expect(await qtyOf(part.id)).toBe(7);
    const [m] = await db.select().from(stockMovements).where(eq(stockMovements.refId, ret.id));
    expect(m).toMatchObject({ type: "RETURN", qtyChange: 2, unitCost: "400.00", refType: "return" });
    const out = await invoiceOutstanding(db, [inv.id]);
    expect(out.get(inv.id)?.outstanding).toBe("3000.00");
    expect(await customerBalance(db, customerId)).toBe("3000.00");
  });

  it("refuses to return more than was sold, counting earlier returns", async () => {
    const { inv, item } = await sell(5);
    await createReturn(staff, { invoiceId: inv.id, reason: "x", lines: [{ invoiceItemId: item.id, qty: 2, restock: true }] });
    const err = await createReturn(staff, {
      invoiceId: inv.id,
      reason: "x",
      lines: [{ invoiceItemId: item.id, qty: 4, restock: true }],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ReturnQtyExceeded);
    expect(err.details).toMatchObject({ returnable: 3, requested: 4 });
  });

  it("gives credit without restocking damaged goods", async () => {
    const { customerId, part, inv, item } = await sell(2);
    const ret = await createReturn(staff, {
      invoiceId: inv.id,
      reason: "Arrived cracked",
      lines: [{ invoiceItemId: item.id, qty: 1, restock: false }],
    });
    expect(await qtyOf(part.id)).toBe(8);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.refId, ret.id))).toHaveLength(0);
    expect(await customerBalance(db, customerId)).toBe("1000.00");
  });

  it("carries line discount, invoice discount and VAT into the credit", async () => {
    await db.update(settings).set({ vatEnabled: true, vatRate: "18.00" });
    const tiers = await tierIds();
    const customer = await makeCustomer({ creditLimit: "100000.00" });
    const part = await makePart({ qty: 10, prices: [{ tierId: tiers.Retail, price: "33.33" }] });
    const inv = await createInvoice(admin, {
      customerId: customer.id,
      paymentType: "credit",
      lines: [{ partId: part.id, qty: 3, discount: { type: "percent", value: "10" } }],
    });
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
    const ret = await createReturn(staff, {
      invoiceId: inv.id,
      reason: "x",
      lines: [{ invoiceItemId: item.id, qty: 1, restock: true }],
    });
    expect(ret).toMatchObject({ subtotal: "30.00", total: "35.40" });
  });

  it("refuses a cancelled invoice", async () => {
    const { inv, item } = await sell(1);
    await cancelInvoice(admin, inv.id, "mistake");
    await expect(
      createReturn(staff, { invoiceId: inv.id, reason: "x", lines: [{ invoiceItemId: item.id, qty: 1, restock: true }] }),
    ).rejects.toBeInstanceOf(InvalidState);
  });

  describe("walk-in customer", () => {
    async function walkInSale() {
      const [walkIn] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
      return sell(2, { customerId: walkIn.id, paymentType: "cash" });
    }

    it("must be refunded", async () => {
      const { inv, item } = await walkInSale();
      await expect(
        createReturn(staff, { invoiceId: inv.id, reason: "x", lines: [{ invoiceItemId: item.id, qty: 1, restock: true }] }),
      ).rejects.toBeInstanceOf(InvalidState);
    });

    it("records a cash refund that brings the balance back to zero", async () => {
      const { customerId, inv, item } = await walkInSale();
      const ret = await createReturn(staff, {
        invoiceId: inv.id,
        reason: "Not needed",
        lines: [{ invoiceItemId: item.id, qty: 1, restock: true }],
        refund: { method: "cash" },
      });
      const [refund] = await db.select().from(payments).where(eq(payments.id, ret.refundPaymentId!));
      expect(refund).toMatchObject({ amount: "-1000.00", isRefund: true, returnId: ret.id, method: "cash" });
      expect(await customerBalance(db, customerId)).toBe("0.00");
      const statement = await customerStatement(customerId);
      expect(statement.rows.map((r) => r.type)).toContain("REFUND");
      expect(statement.closing).toBe("0.00");
    });
  });
});
