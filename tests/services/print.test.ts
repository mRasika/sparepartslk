import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { InvoicePdf } from "@/components/print/invoice-pdf";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers, invoices, settings } from "@/server/db/schema";
import { createInvoice } from "@/server/services/invoicing";
import { cancelQuotation, createQuotation, getQuotation } from "@/server/services/quotations";
import { getInvoicePrintData, getQuotationPrintData } from "@/server/services/print";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let staff: SessionUser;

async function sell() {
  const customer = await makeCustomer({ name: "Ruwan Traders" });
  await db.update(customers).set({ tin: "114567890", address: "12 Galle Rd, Colombo 03" }).where(eq(customers.id, customer.id));
  const part = await makePart({ sku: "CHN-428", name: "Chain Kit 428H", qty: 5 });
  return createInvoice(staff, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 2 }] });
}

describe("getInvoicePrintData", () => {
  beforeEach(async () => {
    await resetDb();
    staff = await makeUser("staff", { fullName: "Dilani" });
    await db.update(settings).set({ businessName: "Sparepartslk", tin: "409876543", phone: "011 222 3344" });
  });

  it("titles a VAT invoice TAX INVOICE and includes both TINs", async () => {
    await db.update(settings).set({ vatEnabled: true, vatRate: "18.00" });
    const inv = await sell();
    const data = await getInvoicePrintData(staff, inv.id);
    expect(data.kind).toBe("invoice");
    expect(data.title).toBe("TAX INVOICE");
    expect(data.customer.tin).toBe("114567890");
    expect(data.business.tin).toBe("409876543");
    expect(data).toMatchObject({ subtotal: "2000.00", vatRate: "18.00", vatAmount: "360.00", total: "2360.00" });
    expect(data.amountInWords).toBe("Rupees Two Thousand Three Hundred Sixty Only");
    expect(data.lines[0]).toMatchObject({ sku: "CHN-428", description: "Chain Kit 428H", qty: 2, lineTotal: "2000.00" });
    expect(data.preparedBy).toBe("Dilani");
  });

  it("titles a non-VAT invoice INVOICE", async () => {
    const inv = await sell();
    const data = await getInvoicePrintData(staff, inv.id);
    expect(data.title).toBe("INVOICE");
    expect(data.status).toBe("issued");
  });

  it("renders a one-page A4 PDF from the print data", async () => {
    const inv = await sell();
    const data = await getInvoicePrintData(staff, inv.id);
    const pdf = Buffer.from(await renderToBuffer(InvoicePdf({ data })));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
    // A4 is 595.28 x 841.89 points.
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+595\.2\d*\s+841\.8\d*\s*\]/);
  });

  it("marks a cancelled invoice", async () => {
    const inv = await sell();
    await db.update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, inv.id));
    const data = await getInvoicePrintData(staff, inv.id);
    expect(data.status).toBe("cancelled");
  });
});

describe("getQuotationPrintData", () => {
  async function quote() {
    const [walkIn] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
    const part = await makePart({ sku: "CHN-428", name: "Chain Kit 428H", qty: 5 });
    return createQuotation(staff, {
      customerId: walkIn.id,
      paymentType: "cash",
      lines: [{ partId: part.id, qty: 2 }],
      invoiceDiscount: undefined,
      quoteForName: "Nimal Perera",
      quoteForPhone: "0771234567",
      note: "Fits CD70",
    });
  }

  beforeEach(async () => {
    await resetDb();
    staff = await makeUser("staff", { fullName: "Dilani" });
    await db.update(settings).set({ businessName: "Sparepartslk" });
  });

  it("prints a quotation", async () => {
    const { id, number } = await quote();
    const q = await getQuotation(id);
    const data = await getQuotationPrintData(id);
    expect(data).toMatchObject({
      kind: "quotation",
      title: "QUOTATION",
      number,
      status: "issued",
      validUntil: q.validUntil,
      note: "Fits CD70",
      amountInWords: "",
      preparedBy: "Dilani",
    });
    expect(data.customer).toMatchObject({ name: "Nimal Perera", phone: "0771234567" });
    expect(data.lines[0]).toMatchObject({ sku: "CHN-428", qty: 2 });
  });

  it("marks a cancelled quotation", async () => {
    const { id } = await quote();
    await cancelQuotation(staff, id, "Customer changed mind");
    expect((await getQuotationPrintData(id)).status).toBe("cancelled");
  });

  it("renders the quotation PDF", async () => {
    const { id } = await quote();
    const data = await getQuotationPrintData(id);
    const buffer = await renderToBuffer(InvoicePdf({ data }));
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
