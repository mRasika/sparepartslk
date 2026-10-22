import { amountInWords } from "@/lib/amount-in-words";
import { D } from "@/lib/money";
import type { SessionUser } from "@/server/auth";
import { getInvoice } from "@/server/services/invoicing";
import { getSettings } from "@/server/services/settings";

export type InvoicePrintData = {
  business: { name: string; address: string; phone: string; email: string; tin: string; logoUrl: string | null };
  title: "TAX INVOICE" | "INVOICE";
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
  };
}
