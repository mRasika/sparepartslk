import { amountInWords } from "@/lib/amount-in-words";
import { D } from "@/lib/money";
import type { SessionUser } from "@/server/auth";
import { getInvoice } from "@/server/services/invoicing";
import { getQuotation } from "@/server/services/quotations";
import { getSettings } from "@/server/services/settings";

export type InvoicePrintData = {
  business: { name: string; address: string; phone: string; email: string; tin: string; logoUrl: string | null };
  kind: "invoice" | "quotation";
  title: "TAX INVOICE" | "INVOICE" | "QUOTATION";
  number: string;
  date: string;
  dueDate: string;
  paymentType: "cash" | "credit";
  customer: { name: string; businessName: string | null; address: string | null; tin: string | null; phone: string | null };
  lines: { sku: string; description: string; qty: number; unitPrice: string; discount: string; lineTotal: string }[];
  subtotal: string;
  invoiceDiscount: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  amountInWords: string;
  preparedBy: string;
  status: "issued" | "cancelled";
  /** Quotations only. */
  validUntil: string | null;
  note: string | null;
};

/** Everything the A4, thermal and PDF templates print, from the invoice's own snapshots. */
export async function getInvoicePrintData(user: SessionUser, id: string): Promise<InvoicePrintData> {
  const [inv, settings] = await Promise.all([getInvoice(user, id), getSettings()]);
  return {
    business: {
      name: settings.businessName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      tin: settings.tin,
      logoUrl: settings.logoUrl,
    },
    // The title follows the VAT rate frozen on the invoice, not today's setting.
    kind: "invoice",
    title: D(inv.vatRate).greaterThan(0) ? "TAX INVOICE" : "INVOICE",
    number: inv.number,
    date: inv.invoiceDate,
    dueDate: inv.dueDate,
    paymentType: inv.paymentType,
    customer: {
      name: inv.customer.name,
      businessName: inv.customer.businessName,
      address: inv.customer.address,
      tin: inv.customer.tin,
      phone: inv.customer.phone,
    },
    lines: inv.items.map((i) => ({
      sku: i.sku,
      description: i.description,
      qty: i.qty,
      unitPrice: i.unitPrice,
      discount: i.discount,
      lineTotal: i.lineTotal,
    })),
    subtotal: inv.subtotal,
    invoiceDiscount: inv.discountTotal,
    vatRate: inv.vatRate,
    vatAmount: inv.vatAmount,
    total: inv.total,
    amountInWords: amountInWords(inv.total),
    preparedBy: inv.createdByName,
    status: inv.status,
    validUntil: null,
    note: null,
  };
}

/** The same print shape for a quotation: no payment, no amount in words, valid-until instead of due date. */
export async function getQuotationPrintData(id: string): Promise<InvoicePrintData> {
  const [q, settings] = await Promise.all([getQuotation(id), getSettings()]);
  // A walk-in quotation is printed for the name the customer gave, not "Walk-in".
  const quoteFor = q.customer.isWalkIn && q.quoteForName;
  return {
    business: {
      name: settings.businessName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      tin: settings.tin,
      logoUrl: settings.logoUrl,
    },
    kind: "quotation",
    title: "QUOTATION",
    number: q.number,
    date: q.quotationDate,
    dueDate: q.validUntil,
    paymentType: q.paymentType,
    customer: quoteFor
      ? { name: q.quoteForName!, businessName: null, address: null, tin: null, phone: q.quoteForPhone }
      : {
          name: q.customer.name,
          businessName: q.customer.businessName,
          address: q.customer.address,
          tin: q.customer.tin,
          phone: q.customer.phone,
        },
    lines: q.items.map((i) => ({
      sku: i.sku,
      description: i.description,
      qty: i.qty,
      unitPrice: i.unitPrice,
      discount: i.discount,
      lineTotal: i.lineTotal,
    })),
    subtotal: q.subtotal,
    invoiceDiscount: q.discountTotal,
    vatRate: q.vatRate,
    vatAmount: q.vatAmount,
    total: q.total,
    amountInWords: "",
    preparedBy: q.createdByName,
    status: q.status === "cancelled" ? "cancelled" : "issued",
    validUntil: q.validUntil,
    note: q.note,
  };
}
