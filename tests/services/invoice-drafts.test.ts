import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { invoiceDrafts } from "@/server/db/schema";
import { PriceMissing } from "@/server/errors";
import {
  discardInvoiceDraft,
  getInvoiceDraftForEditor,
  listInvoiceDrafts,
  previewAndSaveDraft,
} from "@/server/services/invoice-drafts";
import { createInvoice } from "@/server/services/invoicing";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let staff: SessionUser;
let other: SessionUser;

async function draftRow(id: string) {
  const [row] = await db.select().from(invoiceDrafts).where(eq(invoiceDrafts.id, id));
  return row;
}

describe("invoice drafts", () => {
  beforeEach(async () => {
    await resetDb();
    staff = await makeUser("staff", { fullName: "Saman" });
    other = await makeUser("staff", { fullName: "Kamal" });
  });

  it("saves the draft with each preview and updates the same row", async () => {
    const customer = await makeCustomer({ tier: "Dealer" });
    const part = await makePart({ qty: 10 });
    const id = randomUUID();

    const preview = await previewAndSaveDraft(
      staff,
      { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 2 }] },
      id,
    );
    expect(preview.total).toBe("1800.00");
    let row = await draftRow(id);
    expect(row).toMatchObject({ customerId: customer.id, lineCount: 1, total: "1800.00", createdBy: staff.id });

    await previewAndSaveDraft(
      other,
      { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 3 }] },
      id,
    );
    row = await draftRow(id);
    expect(row).toMatchObject({ total: "2700.00", createdBy: staff.id, updatedBy: other.id });
    expect(row.data.lines).toEqual([{ partId: part.id, qty: 3 }]);
    expect(await db.$count(invoiceDrafts)).toBe(1);
  });

  it("still saves the draft when the preview fails, without a total", async () => {
    const customer = await makeCustomer();
    const unpriced = await makePart({ qty: 5, prices: [] });
    const id = randomUUID();

    await expect(
      previewAndSaveDraft(
        staff,
        { customerId: customer.id, paymentType: "cash", lines: [{ partId: unpriced.id, qty: 1 }] },
        id,
      ),
    ).rejects.toBeInstanceOf(PriceMissing);
    expect(await draftRow(id)).toMatchObject({ lineCount: 1, total: null });
  });

  it("issuing the invoice deletes its draft", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 10 });
    const id = randomUUID();
    const input = { customerId: customer.id, paymentType: "cash" as const, lines: [{ partId: part.id, qty: 1 }] };
    await previewAndSaveDraft(staff, input, id);

    await createInvoice(staff, { ...input, draftId: id });
    expect(await draftRow(id)).toBeUndefined();
  });

  it("lists drafts newest first, skips the open one and clears drafts older than 7 days", async () => {
    const customer = await makeCustomer({ name: "Nimal" });
    const part = await makePart({ qty: 10 });
    const input = { customerId: customer.id, paymentType: "cash" as const, lines: [{ partId: part.id, qty: 1 }] };
    const [old, older, open, newest] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of [old, older, open, newest]) await previewAndSaveDraft(staff, input, id);
    await db
      .update(invoiceDrafts)
      .set({ updatedAt: sql`now() - interval '8 days'` })
      .where(eq(invoiceDrafts.id, old));
    await db
      .update(invoiceDrafts)
      .set({ updatedAt: sql`now() - interval '1 hour'` })
      .where(eq(invoiceDrafts.id, older));

    const rows = await listInvoiceDrafts({ excludeId: open });
    expect(rows.map((r) => r.id)).toEqual([newest, older]);
    expect(rows[0]).toMatchObject({ customerName: "Nimal", lineCount: 1, total: "1000.00", updatedByName: "Saman" });
    expect(await draftRow(old)).toBeUndefined();
  });

  it("loads a draft for the editor with current part details and the customer's prices", async () => {
    const customer = await makeCustomer({ tier: "Wholesale" });
    const part = await makePart({ qty: 4, sku: "BRK-1" });
    const id = randomUUID();
    await previewAndSaveDraft(
      staff,
      {
        customerId: customer.id,
        paymentType: "cash",
        lines: [{ partId: part.id, qty: 2, discount: { type: "percent", value: "5" } }],
        invoiceDiscount: { type: "amount", value: "10" },
        cashPayment: { method: "bank", reference: "TX1" },
      },
      id,
    );

    const draft = await getInvoiceDraftForEditor(id);
    expect(draft).toMatchObject({
      id,
      paymentType: "cash",
      customer: { id: customer.id },
      invoiceDiscount: { type: "amount", value: "10" },
      cashPayment: { method: "bank", reference: "TX1" },
    });
    expect(draft!.lines).toEqual([
      {
        part: expect.objectContaining({ id: part.id, sku: "BRK-1", qtyOnHand: 4, price: "850.00" }),
        qty: 2,
        discount: { type: "percent", value: "5" },
      },
    ]);
    expect(await getInvoiceDraftForEditor(randomUUID())).toBeNull();
    expect(await getInvoiceDraftForEditor("not-a-uuid")).toBeNull();
  });

  it("discards a draft", async () => {
    const customer = await makeCustomer();
    const part = await makePart({ qty: 1 });
    const id = randomUUID();
    await previewAndSaveDraft(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] }, id);
    await discardInvoiceDraft(staff, id);
    expect(await draftRow(id)).toBeUndefined();
  });
});
