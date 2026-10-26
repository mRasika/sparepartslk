import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import {
  customers,
  invoices,
  partPrices,
  parts,
  payments,
  quotations,
  settings,
  stockMovements,
} from "@/server/db/schema";
import { DiscountNotAllowed, InvalidState } from "@/server/errors";
import {
  cancelQuotation,
  createQuotation,
  getQuotation,
  getQuotationForEditor,
  listQuotations,
  updateQuotation,
  type QuotationInput,
} from "@/server/services/quotations";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;

async function walkIn() {
  const [row] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
  return row;
}

const inputOf = (customerId: string, partId: string, extra: Partial<QuotationInput> = {}): QuotationInput => ({
  customerId,
  paymentType: "cash",
  lines: [{ partId, qty: 1 }],
  invoiceDiscount: undefined,
  ...extra,
});

describe("quotations", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("numbers a quotation and prices it from the customer's tier", async () => {
    const customer = await makeCustomer({ tier: "Dealer" });
    const part = await makePart({ qty: 2 });
    const { id, number } = await createQuotation(
      staff,
      inputOf(customer.id, part.id, { lines: [{ partId: part.id, qty: 2 }] }),
    );
    expect(number).toMatch(/^QUO-\d{4}-000001$/);
    const q = await getQuotation(id);
    expect(q.subtotal).toBe("1800.00");
    expect(q.total).toBe("1800.00");
    expect(q.status).toBe("open");
    expect(q.validUntil).toBe(addDays(colomboDate(), 14));
    expect(q.items[0].unitPrice).toBe("900.00");
  });

  it("adds VAT when VAT is on", async () => {
    await db.update(settings).set({ vatEnabled: true, vatRate: "18.00" });
    const customer = await makeCustomer();
    const part = await makePart({ qty: 2 });
    const { id } = await createQuotation(staff, inputOf(customer.id, part.id));
    const q = await getQuotation(id);
    expect(q.vatAmount).toBe("180.00");
    expect(q.total).toBe("1180.00");
    expect(q.vatRate).toBe("18.00");
  });

  it("keeps the discount as typed", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 2 });
    const { id } = await createQuotation(
      admin,
      inputOf(customer.id, part.id, {
        lines: [{ partId: part.id, qty: 1, discount: { type: "percent", value: "10" } }],
        invoiceDiscount: { type: "amount", value: "50" },
      }),
    );
    const q = await getQuotation(id);
    expect(q.items[0].discount).toBe("100.00");
    const editor = await getQuotationForEditor(id);
    expect(editor!.lines[0].discount).toEqual({ type: "percent", value: "10.00" });
    expect(editor!.invoiceDiscount).toEqual({ type: "amount", value: "50.00" });
  });

  it("caps staff discounts but not admin", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 2 });
    const input = inputOf(customer.id, part.id, {
      lines: [{ partId: part.id, qty: 1, discount: { type: "percent", value: "50" } }],
    });
    await expect(createQuotation(staff, input)).rejects.toBeInstanceOf(DiscountNotAllowed);
    await expect(createQuotation(admin, input)).resolves.toBeDefined();
  });

  it("quotes out-of-stock parts but not inactive ones", async () => {
    const customer = await makeCustomer();
    const empty = await makePart({ qty: 0 });
    await expect(
      createQuotation(staff, inputOf(customer.id, empty.id, { lines: [{ partId: empty.id, qty: 5 }] })),
    ).resolves.toBeDefined();
    const inactive = await makePart({ qty: 3, isActive: false });
    await expect(createQuotation(staff, inputOf(customer.id, inactive.id))).rejects.toBeInstanceOf(InvalidState);
  });

  it("keeps the quote-for name only for the walk-in", async () => {
    const part = await makePart({ qty: 2 });
    const w = await walkIn();
    const extra = { quoteForName: "Nimal", quoteForPhone: "0771234567" };
    const a = await createQuotation(staff, inputOf(w.id, part.id, extra));
    const qa = await getQuotation(a.id);
    expect([qa.quoteForName, qa.quoteForPhone]).toEqual(["Nimal", "0771234567"]);
    const dealer = await makeCustomer({ tier: "Dealer" });
    const b = await createQuotation(staff, inputOf(dealer.id, part.id, extra));
    const qb = await getQuotation(b.id);
    expect([qb.quoteForName, qb.quoteForPhone]).toEqual([null, null]);
  });

  it("refuses credit for the walk-in and an inactive customer", async () => {
    const part = await makePart({ qty: 2 });
    const w = await walkIn();
    await expect(createQuotation(staff, inputOf(w.id, part.id, { paymentType: "credit" }))).rejects.toBeInstanceOf(
      InvalidState,
    );
    const gone = await makeCustomer({ isActive: false });
    await expect(createQuotation(staff, inputOf(gone.id, part.id))).rejects.toBeInstanceOf(InvalidState);
  });

  it("refuses valid until before today", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 2 });
    const input = inputOf(customer.id, part.id, { validUntil: addDays(colomboDate(), -1) });
    await expect(createQuotation(staff, input)).rejects.toThrow("Valid until can't be before the quotation date");
    await expect(createQuotation(staff, input)).rejects.toBeInstanceOf(InvalidState);
  });

  it("edits an open or expired quotation and re-prices it", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 2 });
    const { id, number } = await createQuotation(staff, inputOf(customer.id, part.id));
    await db.update(partPrices).set({ price: "1100.00" }).where(eq(partPrices.partId, part.id));
    const old = addDays(colomboDate(), -30);
    await db.update(quotations).set({ quotationDate: old, validUntil: old }).where(eq(quotations.id, id));
    expect((await getQuotation(id)).status).toBe("expired");

    const other = await makeUser("staff");
    await updateQuotation(other, id, inputOf(customer.id, part.id, { validUntil: addDays(colomboDate(), 14) }));
    const q = await getQuotation(id);
    expect(q.number).toBe(number);
    expect(q.items[0].unitPrice).toBe("1100.00");
    expect(q.status).toBe("open");
    expect(q.updatedByName).toBe(other.fullName);
  });

  it("refuses to edit or cancel a cancelled quotation", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 2 });
    const input = inputOf(customer.id, part.id);
    const { id } = await createQuotation(staff, input);
    await expect(cancelQuotation(staff, id, "  ")).rejects.toThrow();
    await cancelQuotation(staff, id, "Customer bought elsewhere");
    const q = await getQuotation(id);
    expect(q.status).toBe("cancelled");
    expect(q.cancelReason).toBe("Customer bought elsewhere");
    await expect(updateQuotation(staff, id, input)).rejects.toThrow(/is cancelled and can't be changed/);
    await expect(updateQuotation(staff, id, input)).rejects.toBeInstanceOf(InvalidState);
    await expect(cancelQuotation(staff, id, "Again")).rejects.toBeInstanceOf(InvalidState);
  });

  it("never touches stock, payments or invoices", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 4 });
    const movements = await db.$count(stockMovements);
    const input = inputOf(customer.id, part.id, { lines: [{ partId: part.id, qty: 2 }] });
    const { id } = await createQuotation(staff, input);
    await updateQuotation(staff, id, input);
    await cancelQuotation(staff, id, "No longer needed");
    expect(await db.$count(stockMovements)).toBe(movements);
    expect(await db.$count(payments)).toBe(0);
    expect(await db.$count(invoices)).toBe(0);
    const [row] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(row.qtyOnHand).toBe(4);
  });

  it("lists newest first, searches and filters by status", async () => {
    const part = await makePart({ qty: 2 });
    const w = await walkIn();
    const customer = await makeCustomer();
    const a = await createQuotation(staff, inputOf(w.id, part.id, { quoteForName: "Nimal" }));
    const b = await createQuotation(staff, inputOf(customer.id, part.id));
    const c = await createQuotation(staff, inputOf(customer.id, part.id));
    const d = await createQuotation(staff, inputOf(customer.id, part.id));
    await cancelQuotation(staff, c.id, "Changed mind");
    const old = addDays(colomboDate(), -30);
    await db.update(quotations).set({ quotationDate: old, validUntil: old }).where(eq(quotations.id, d.id));

    const all = await listQuotations();
    expect(all.map((r) => r.id)).toEqual([c.id, b.id, a.id, d.id]);
    expect((await listQuotations({ q: "Nimal" })).map((r) => r.id)).toEqual([a.id]);
    expect((await listQuotations({ status: "expired" })).map((r) => r.id)).toEqual([d.id]);
    expect((await listQuotations({ status: "open" })).map((r) => r.id)).toEqual([b.id, a.id]);
  });
});
