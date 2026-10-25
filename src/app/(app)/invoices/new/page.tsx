import { eq } from "drizzle-orm";
import { InvoiceEditor } from "@/components/billing/invoice-editor";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { getCustomer, type CustomerRow } from "@/server/services/customers";
import { getInvoiceDraftForEditor, listInvoiceDrafts } from "@/server/services/invoice-drafts";
import { getSettings } from "@/server/services/settings";
import { DraftList } from "./draft-list";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; draft?: string }>;
}) {
  const user = await requireUser();
  const { customerId, draft: draftId } = await searchParams;
  const [settings, draft, drafts] = await Promise.all([
    getSettings(),
    draftId ? getInvoiceDraftForEditor(draftId) : null,
    listInvoiceDrafts({ excludeId: draftId }),
  ]);

  let customer: CustomerRow | null = draft?.customer.isActive ? draft.customer : null;
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
      <PageHeader title={draft ? "Continue invoice" : "New invoice"} />
      <DraftList drafts={drafts} />
      <InvoiceEditor
        key={draft?.id ?? "new"}
        initialCustomer={customer}
        draft={draft ?? undefined}
        isAdmin={user.role === "admin"}
        vatRate={settings.vatEnabled ? settings.vatRate : "0"}
        staffCapPct={settings.staffMaxDiscountPct}
      />
    </div>
  );
}
