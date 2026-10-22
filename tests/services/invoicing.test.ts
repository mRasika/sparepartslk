import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate, colomboYear } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import {
  customers,
  invoiceItems,
  invoices,
  parts,
  paymentAllocations,
  payments,
  settings,
  stockMovements,
} from "@/server/db/schema";
import {
  CreditLimitExceeded,
  Forbidden,
  InsufficientStock,
  InvalidState,
} from "@/server/errors";
import { customerBalance } from "@/server/services/customers";
import { createInvoice, getInvoice, listInvoices, previewInvoice } from "@/server/services/invoicing";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser, tierIds } from "../helpers/factories";

const year = colomboYear();
let admin: SessionUser;
let staff: SessionUser;

async function partRow(id: string) {
  const [row] = await db.select().from(parts).where(eq(parts.id, id));
  return row;
}

async function priced(price: string, qty: number) {
  const tiers = await tierIds();
  return makePart({ qty, avgCost: "500.00", prices: [{ tierId: tiers.Retail, price }] });
}

describe("createInvoice", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("issues a credit invoice: number, stock, ledger, cost snapshot, due date, balance", async () => {
    const customer = await makeCustomer({ creditLimit: "100000.00", creditDays: 30 });
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    const inv = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "credit",
      lines: [{ partId: part.id, qty: 3 }],
    });
    expect(inv.number).toBe(`INV-${year}-000001`);
    expect((await partRow(part.id)).qtyOnHand).toBe(7);

    const sales = await db.select().from(stockMovements).where(eq(stockMovements.refId, inv.id));
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ type: "SALE", qtyChange: -3, balanceAfter: 7, refType: "invoice" });

    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
    expect(item).toMatchObject({ unitCost: "600.00", unitPrice: "1000.00", lineTotal: "3000.00" });

    const [header] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(header.dueDate).toBe(addDays(header.invoiceDate, 30));
    expect(header.invoiceDate).toBe(colomboDate());
    expect(header.total).toBe("3000.00");
    expect(await customerBalance(db, customer.id)).toBe("3000.00");
  });

  it("uses the customer's tier price", async () => {
    const customer = await makeCustomer({ tier: "Dealer", creditLimit: "100000.00" });
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "credit", lines: [{ partId: part.id, qty: 1 }] });
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
    expect(item.unitPrice).toBe("900.00");
  });

  it("records a fully allocated payment for a cash sale", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: part.id, qty: 2 }],
    });
    const [pay] = await db.select().from(payments).where(eq(payments.invoiceId, inv.id));
    expect(pay).toMatchObject({ amount: "2000.00", method: "cash", status: "active" });
    expect(pay.number).toBe(`PAY-${year}-000001`);
    const allocs = await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, pay.id));
    expect(allocs).toHaveLength(1);
    expect(allocs[0]).toMatchObject({ invoiceId: inv.id, amount: "2000.00" });
    expect(await customerBalance(db, customer.id)).toBe("0.00");
  });

  it("checks stock against the summed qty when a part is on two lines", async () => {
    const customer = await makeCustomer({ creditLimit: "100000.00" });
    const part = await makePart({ sku: "TWICE-1", qty: 5 });
    const err = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "credit",
      lines: [
        { partId: part.id, qty: 3 },
        { partId: part.id, qty: 3 },
      ],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientStock);
    expect(err.details).toMatchObject({ sku: "TWICE-1", available: 5, requested: 6 });
    expect((await partRow(part.id)).qtyOnHand).toBe(5);
    expect(await db.select().from(invoices)).toHaveLength(0);

    const ok = await createInvoice(staff, { customerId: customer.id, paymentType: "credit", lines: [{ partId: part.id, qty: 1 }] });
    expect(ok.number).toBe(`INV-${year}-000001`);
  });

  it("sells the last unit to exactly one of two simultaneous invoices", async () => {
    const customer = await makeCustomer({ creditLimit: "100000.00" });
    const part = await makePart({ qty: 1 });
    const make = () =>
      createInvoice(staff, { customerId: customer.id, paymentType: "credit", lines: [{ partId: part.id, qty: 1 }] });
    const results = await Promise.allSettled([make(), make()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InsufficientStock);
    expect((await partRow(part.id)).qtyOnHand).toBe(0);
  });

  describe("credit limit", () => {
    async function setup() {
      const customer = await makeCustomer({ creditLimit: "1000.00" });
      const first = await priced("800.00", 5);
      const second = await priced("300.00", 5);
      await createInvoice(staff, { customerId: customer.id, paymentType: "credit", lines: [{ partId: first.id, qty: 1 }] });
      return { customer, second };
    }

    it("rejects an invoice that takes the balance over the limit", async () => {
      const { customer, second } = await setup();
      const err = await createInvoice(staff, {
        customerId: customer.id,
        paymentType: "credit",
        lines: [{ partId: second.id, qty: 1 }],
      }).catch((e) => e);
      expect(err).toBeInstanceOf(CreditLimitExceeded);
      expect(err.details).toMatchObject({ balance: "800.00", limit: "1000.00", invoiceTotal: "300.00" });
    });

    it("lets an admin override and records it", async () => {
      const { customer, second } = await setup();
      const inv = await createInvoice(admin, {
        customerId: customer.id,
        paymentType: "credit",
        lines: [{ partId: second.id, qty: 1 }],
        overrideCreditLimit: true,
      });
      const [header] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
      expect(header.creditOverride).toBe(true);
    });

    it("forbids staff from overriding", async () => {
      const { customer, second } = await setup();
      await expect(
        createInvoice(staff, {
          customerId: customer.id,
          paymentType: "credit",
          lines: [{ partId: second.id, qty: 1 }],
          overrideCreditLimit: true,
        }),
      ).rejects.toBeInstanceOf(Forbidden);
    });

    it("does not credit-check cash sales", async () => {
      const { customer, second } = await setup();
      await expect(
        createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: second.id, qty: 1 }] }),
      ).resolves.toHaveProperty("number");
    });
  });

  it("refuses an inactive customer", async () => {
    const customer = await makeCustomer({ isActive: false });
    const part = await makePart({ qty: 5 });
    await expect(
      createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] }),
    ).rejects.toBeInstanceOf(InvalidState);
  });

  it("refuses an inactive part", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 5, isActive: false });
    await expect(
      createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] }),
    ).rejects.toBeInstanceOf(InvalidState);
  });

  it("never sells to the walk-in customer on credit", async () => {
    const [walkIn] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
    const part = await makePart({ qty: 5 });
    await expect(
      createInvoice(admin, { customerId: walkIn.id, paymentType: "credit", lines: [{ partId: part.id, qty: 1 }] }),
    ).rejects.toBeInstanceOf(InvalidState);
  });

  it("snapshots the VAT rate when VAT is on", async () => {
    await db.update(settings).set({ vatEnabled: true, vatRate: "18.00" });
    const customer = await makeCustomer();
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    const [header] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(header).toMatchObject({ vatRate: "18.00", subtotal: "1000.00", vatAmount: "180.00", total: "1180.00" });
  });

  it("stores 0 VAT when VAT is off", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 5 });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    const [header] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(header).toMatchObject({ vatRate: "0.00", vatAmount: "0.00", total: "1000.00" });
  });
});

describe("invoice queries", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("finds an invoice by number", async () => {
    const customer = await makeCustomer({ name: "Kamal Auto" });
    const part = await makePart({ qty: 10 });
    const sell = () =>
      createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    await sell();
    const second = await sell();
    await sell();
    const rows = await listInvoices({ q: `INV-${year}-000002` });
    expect(rows.map((r) => r.id)).toEqual([second.id]);
    expect(rows[0]).toMatchObject({ customerName: "Kamal Auto", total: "1000.00", status: "issued" });
    expect(await listInvoices({ q: "kamal" })).toHaveLength(3);
  });

  it("hides line cost from staff", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 10, avgCost: "640.00" });
    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    const forStaff = await getInvoice(staff, inv.id);
    expect(forStaff.items[0]).not.toHaveProperty("unitCost");
    const forAdmin = await getInvoice(admin, inv.id);
    expect(forAdmin.items[0].unitCost).toBe("640.00");
  });

  it("previews prices, stock and totals without writing anything", async () => {
    const customer = await makeCustomer({ tier: "Dealer" });
    const part = await makePart({ qty: 4 });
    const preview = await previewInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: part.id, qty: 2, discount: { type: "percent", value: "5" } }],
    });
    expect(preview.prices[part.id]).toBe("900.00");
    expect(preview.stock[part.id]).toBe(4);
    expect(preview.total).toBe("1710.00");
    expect(await db.select().from(invoices)).toHaveLength(0);
  });
});
