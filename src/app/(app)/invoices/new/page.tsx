import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { InvoiceEditor } from "@/components/billing/invoice-editor";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { cachedSettings, partFilterOptions } from "@/server/cached";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { getCustomer, type CustomerRow } from "@/server/services/customers";
import { getInvoiceDraftForEditor, listInvoiceDrafts } from "@/server/services/invoice-drafts";
import { getQuotationForInvoice } from "@/server/services/quotation-conversion";
import { DraftList } from "./draft-list";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; draft?: string; quotation?: string }>;
}) {
  const user = await requireUser();
  const { customerId, draft: draftId, quotation: quotationId } = await searchParams;
  const [settings, draft, fromQuote, drafts, filters] = await Promise.all([
    cachedSettings(),
    draftId ? getInvoiceDraftForEditor(draftId) : null,
    quotationId && !draftId ? getQuotationForInvoice(quotationId) : null,
    listInvoiceDrafts({ excludeId: draftId }),
    partFilterOptions(),
  ]);
  // Converted, cancelled or unknown: the quotation page says why.
  if (quotationId && !draftId && !fromQuote) redirect(`/quotations/${quotationId}`);

  const source = draft ?? fromQuote;
  let customer: CustomerRow | null = source?.customer.isActive ? source.customer : null;
  if (!customer && customerId) {
    customer = await getCustomer(customerId).catch(() => null);
    if (customer && !customer.isActive) customer = null;
  }
  if (!customer) {
    const [walkIn] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isWalkIn, true));
    customer = await getCustomer(walkIn.id);
  }

  return (
    <div>
      <PageHeader
        title={draft ? "Continue invoice" : fromQuote ? `Invoice from ${fromQuote.quotation.number}` : "New invoice"}
      />
      <DraftList drafts={drafts} />
      <InvoiceEditor
        key={draft?.id ?? fromQuote?.quotation.id ?? "new"}
        initialCustomer={customer}
        // A conversion starts as an unsaved draft: its first auto-save creates one.
        draft={
          draft ??
          (fromQuote
            ? { paymentType: fromQuote.paymentType, lines: fromQuote.lines, invoiceDiscount: fromQuote.invoiceDiscount }
            : undefined)
        }
        quotation={draft?.quotation ?? fromQuote?.quotation}
        partFilters={filters}
        isAdmin={user.role === "admin"}
        vatRate={settings.vatEnabled ? settings.vatRate : "0"}
        staffCapPct={settings.staffMaxDiscountPct}
      />
    </div>
  );
}
