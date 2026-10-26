import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers, invoiceItems, invoices, partPrices, quotations } from "@/server/db/schema";
import { InsufficientStock, InvalidState } from "@/server/errors";
import { getInvoiceDraftForEditor, previewAndSaveDraft } from "@/server/services/invoice-drafts";
import {
  cancelInvoice,
  createInvoice,
  getInvoice,
  previewInvoice,
  type InvoiceInput,
} from "@/server/services/invoicing";
import { getQuotationForInvoice } from "@/server/services/quotation-conversion";
import { cancelQuotation, createQuotation, getQuotation } from "@/server/services/quotations";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser, tierIds } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;

async function walkIn() {
  const [row] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
  return row;
}

/** Makes a quotation read as expired: quoted 30 days ago, valid until 16 days ago. */
async function expire(id: string) {
  await db
    .update(quotations)
    .set({ quotationDate: addDays(colomboDate(), -30), validUntil: addDays(colomboDate(), -16) })
    .where(eq(quotations.id, id));
}

async function setRetailPrice(partId: string, price: string) {
  const tiers = await tierIds();
  await db
    .update(partPrices)
    .set({ price })
    .where(and(eq(partPrices.partId, partId), eq(partPrices.tierId, tiers.Retail)));
}

async function items(invoiceId: string) {
  return db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(invoiceItems.lineNo);
}

async function quote(customerId: string, lines: InvoiceInput["lines"], paymentType: "cash" | "credit" = "cash") {
  return createQuotation(staff, { customerId, paymentType, lines, invoiceDiscount: undefined });
}

describe("converting a quotation", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("converts at the quoted price while valid", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: part.id, qty: 2 }]);
    await setRetailPrice(part.id, "1200.00");

    const inv = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: part.id, qty: 2 }],
      quotationId: q.id,
    });

    const [item] = await items(inv.id);
    expect(item.unitPrice).toBe("1000.00");
    const [header] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(header.total).toBe("2000.00");
    const after = await getQuotation(q.id);
    expect(after.status).toBe("converted");
    expect(after.invoice?.number).toBe(inv.number);
  });

  it("keeps the quoted price for a changed qty and prices an added part today", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 2 }]);
    await setRetailPrice(a.id, "1200.00");
    const b = await makePart({ qty: 10 });

    const inv = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [
        { partId: a.id, qty: 5 },
        { partId: b.id, qty: 1 },
      ],
      quotationId: q.id,
    });

    const [lineA, lineB] = await items(inv.id);
    expect(lineA.unitPrice).toBe("1000.00");
    expect(lineB.unitPrice).toBe("1000.00");
    expect(lineA.lineTotal).toBe("5000.00");
  });

  it("keeps the quoted price even when the part no longer has a price", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    await db.delete(partPrices).where(eq(partPrices.partId, a.id));

    const inv = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    });

    const [item] = await items(inv.id);
    expect(item.unitPrice).toBe("1000.00");
  });

  it("prices a part on two lines from one quoted price", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const lines = [
      { partId: a.id, qty: 1 },
      { partId: a.id, qty: 1, discount: { type: "percent" as const, value: "10" } },
    ];
    const q = await quote(customer.id, lines);
    await setRetailPrice(a.id, "1200.00");

    const inv = await createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines, quotationId: q.id });

    const rows = await items(inv.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.unitPrice)).toEqual(["1000.00", "1000.00"]);
    expect(rows.map((r) => r.lineTotal)).toEqual(["1000.00", "900.00"]);
  });

  it("a switched customer keeps quoted prices", async () => {
    const x = await makeCustomer({ creditLimit: "100000.00" });
    const w = await walkIn();
    const a = await makePart({ qty: 10 });
    const q = await quote(x.id, [{ partId: a.id, qty: 1 }]);
    await setRetailPrice(a.id, "1200.00");

    await expect(
      createInvoice(staff, { customerId: w.id, paymentType: "credit", lines: [{ partId: a.id, qty: 1 }], quotationId: q.id }),
    ).rejects.toBeInstanceOf(InvalidState);

    const inv = await createInvoice(staff, {
      customerId: w.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    });
    const [item] = await items(inv.id);
    expect(item.unitPrice).toBe("1000.00");
  });

  it("converts on the last valid day at quoted prices", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    await db.update(quotations).set({ validUntil: colomboDate() }).where(eq(quotations.id, q.id));
    await setRetailPrice(a.id, "1200.00");

    const inv = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    });
    const [item] = await items(inv.id);
    expect(item.unitPrice).toBe("1000.00");
  });

  it("uses today's prices after expiry", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    await expire(q.id);
    await setRetailPrice(a.id, "1200.00");

    const forInvoice = await getQuotationForInvoice(q.id);
    expect(forInvoice?.quotation.expired).toBe(true);
    expect(forInvoice?.quotation.priceChanges).toEqual([{ sku: a.sku, quoted: "1000.00", current: "1200.00" }]);
    expect(forInvoice?.lines[0].part.price).toBe("1200.00");

    const inv = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    });
    const [item] = await items(inv.id);
    expect(item.unitPrice).toBe("1200.00");
    expect((await getQuotation(q.id)).status).toBe("converted");
  });

  it("refuses a second conversion and keeps the first", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    const input: InvoiceInput = {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    };
    await createInvoice(staff, input);

    const second = createInvoice(staff, input);
    await expect(second).rejects.toBeInstanceOf(InvalidState);
    await expect(second).rejects.toThrow(/was already converted to INV-/);
    expect(await db.$count(invoices)).toBe(1);
    expect(await getQuotationForInvoice(q.id)).toBeNull();
  });

  it("refuses converting a cancelled quotation", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    await cancelQuotation(staff, q.id, "Customer went elsewhere");

    const attempt = createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    });
    await expect(attempt).rejects.toBeInstanceOf(InvalidState);
    await expect(attempt).rejects.toThrow(/is cancelled/);
    expect(await getQuotationForInvoice(q.id)).toBeNull();
  });

  it("a failed conversion leaves the quotation open", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 1 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 3 }]);

    await expect(
      createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: a.id, qty: 3 }], quotationId: q.id }),
    ).rejects.toBeInstanceOf(InsufficientStock);

    const after = await getQuotation(q.id);
    expect(after.status).toBe("open");
    expect(after.invoice).toBeNull();
  });

  it("previews with quoted prices", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 2 }]);
    await setRetailPrice(a.id, "1200.00");

    const preview = await previewInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 2 }],
      quotationId: q.id,
    });
    expect(preview.prices[a.id]).toBe("1000.00");
    expect(preview.total).toBe("2000.00");
  });

  it("refuses previewing a converted quotation", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    const input: InvoiceInput = {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    };
    await createInvoice(staff, input);
    await expect(previewInvoice(staff, input)).rejects.toThrow(/was already converted to INV-/);
  });

  it("cancelling the invoice reopens the quotation", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    const input: InvoiceInput = {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    };
    const inv = await createInvoice(staff, input);

    await cancelInvoice(admin, inv.id, "Wrong customer");

    const after = await getQuotation(q.id);
    expect(after.status).toBe("open");
    expect(after.invoice).toBeNull();
    const [row] = await db.select().from(quotations).where(eq(quotations.id, q.id));
    expect(row).toMatchObject({ invoiceId: null, convertedBy: null, convertedAt: null });

    const again = await createInvoice(staff, input);
    expect((await getQuotation(q.id)).invoice?.number).toBe(again.number);
  });

  it("shows the quotation on the invoice", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    const converted = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    });
    const plain = await createInvoice(staff, {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
    });

    expect((await getInvoice(staff, converted.id)).quotation).toEqual({ id: q.id, number: q.number });
    expect((await getInvoice(staff, plain.id)).quotation).toBeNull();
  });

  it("a draft keeps the quotation and its prices", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const b = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 2 }]);
    const draftId = randomUUID();

    await previewAndSaveDraft(
      staff,
      {
        customerId: customer.id,
        paymentType: "cash",
        lines: [
          { partId: a.id, qty: 2 },
          { partId: b.id, qty: 1 },
        ],
        quotationId: q.id,
      },
      draftId,
    );
    await setRetailPrice(a.id, "1200.00");
    await setRetailPrice(b.id, "1100.00");

    const draft = await getInvoiceDraftForEditor(draftId);
    expect(draft?.quotation?.number).toBe(q.number);
    expect(draft?.lines[0].part.price).toBe("1000.00");
    expect(draft?.lines[1].part.price).toBe("1100.00");
  });

  it("a draft of a converted quotation can't issue a second invoice", async () => {
    const customer = await makeCustomer();
    const a = await makePart({ qty: 10 });
    const q = await quote(customer.id, [{ partId: a.id, qty: 1 }]);
    const draftId = randomUUID();
    const input: InvoiceInput = {
      customerId: customer.id,
      paymentType: "cash",
      lines: [{ partId: a.id, qty: 1 }],
      quotationId: q.id,
    };
    await previewAndSaveDraft(staff, input, draftId);
    await createInvoice(admin, input);

    const draft = await getInvoiceDraftForEditor(draftId);
    expect(draft).not.toBeNull();
    expect(draft?.quotation).toBeUndefined();
    expect(draft?.lines[0].part.price).toBe("1000.00");

    const issue = createInvoice(staff, { ...input, draftId });
    await expect(issue).rejects.toBeInstanceOf(InvalidState);
    await expect(issue).rejects.toThrow(/was already converted/);
    expect(await db.$count(invoices)).toBe(1);
  });
});
