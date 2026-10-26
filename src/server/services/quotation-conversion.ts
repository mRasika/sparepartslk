import { eq } from "drizzle-orm";
import { z } from "zod";
import { colomboDate } from "@/lib/dates";
import { db, type Executor } from "@/server/db/client";
import { invoices, quotationItems, quotations } from "@/server/db/schema";
import { NotFound } from "@/server/errors";
// Type-only: invoicing.ts and invoice-drafts.ts import this module at runtime.
import type { EditorDraft } from "@/server/services/invoice-drafts";
import { getQuotationForEditor } from "@/server/services/quotations";

/** What invoicing needs from a quotation to price a conversion (spec §3.3–3.4). */
export type QuotationPrices = {
  id: string;
  number: string;
  status: "open" | "converted" | "cancelled";
  invoiceNumber: string | null;
  expired: boolean;
  validUntil: string;
  /** partId → quoted unit price. A part on two lines has one price (one tier at save time). */
  prices: Map<string, string>;
};

/** Loads a quotation's status and quoted prices; `lock` takes the row lock for a conversion. */
export async function loadQuotationPrices(
  tx: Executor,
  id: string,
  opts: { lock?: boolean } = {},
): Promise<QuotationPrices> {
  if (!z.uuid().safeParse(id).success) throw new NotFound("Quotation not found");
  const query = tx.select().from(quotations).where(eq(quotations.id, id));
  const [q] = opts.lock ? await query.for("update") : await query;
  if (!q) throw new NotFound("Quotation not found");

  // The invoice number is read separately: a row lock can't take the nullable side of a left join.
  const [invoice] = q.invoiceId
    ? await tx.select({ number: invoices.number }).from(invoices).where(eq(invoices.id, q.invoiceId))
    : [];
  const items = await tx
    .select({ partId: quotationItems.partId, unitPrice: quotationItems.unitPrice })
    .from(quotationItems)
    .where(eq(quotationItems.quotationId, id));
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    invoiceNumber: invoice?.number ?? null,
    expired: q.validUntil < colomboDate(),
    validUntil: q.validUntil,
    prices: new Map(items.map((i) => [i.partId, i.unitPrice])),
  };
}

export type QuotationLink = {
  id: string;
  number: string;
  expired: boolean;
  validUntil: string;
  /** Shown as a hint only: the invoice editor never preselects a payment type. */
  paymentType: "cash" | "credit";
  /** Parts whose price moved since quoting; only filled once the quotation has expired. */
  priceChanges: { sku: string; quoted: string; current: string }[];
};

/**
 * An open (valid or expired) quotation ready to load into the invoice editor: its customer, lines
 * and discounts, priced the way `createInvoice` will price them — quoted prices while valid,
 * today's prices for the quotation customer's tier once expired. Null when unknown, converted or
 * cancelled.
 */
export async function getQuotationForInvoice(
  id: string,
): Promise<(Omit<EditorDraft, "id" | "cashPayment"> & { quotation: QuotationLink }) | null> {
  // Today's stock and today's prices for the quotation's customer.
  const editor = await getQuotationForEditor(id);
  if (!editor) return null;
  const quote = await loadQuotationPrices(db, id);

  // One entry per part (a part on two lines shares one price). A part with no price today is left
  // out: the editor reports it as missing anyway.
  const priceChanges: QuotationLink["priceChanges"] = [];
  if (quote.expired) {
    const seen = new Set<string>();
    for (const { part } of editor.lines) {
      const quoted = quote.prices.get(part.id);
      if (seen.has(part.id) || !quoted || !part.price || quoted === part.price) continue;
      seen.add(part.id);
      priceChanges.push({ sku: part.sku, quoted, current: part.price });
    }
  }

  return {
    customer: editor.customer,
    paymentType: editor.paymentType,
    lines: quote.expired
      ? editor.lines
      : editor.lines.map((l) => ({ ...l, part: { ...l.part, price: quote.prices.get(l.part.id) } })),
    invoiceDiscount: editor.invoiceDiscount,
    quotation: {
      id: editor.id,
      number: editor.number,
      expired: quote.expired,
      validUntil: editor.validUntil,
      paymentType: editor.paymentType,
      priceChanges,
    },
  };
}
