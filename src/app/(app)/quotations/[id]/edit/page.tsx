import { redirect } from "next/navigation";
import { QuotationEditor } from "@/components/billing/quotation-editor";
import { PageHeader } from "@/components/page-header";
import { colomboDate } from "@/lib/dates";
import { requireUser } from "@/server/auth";
import { cachedSettings, partFilterOptions } from "@/server/cached";
import { getQuotationForEditor } from "@/server/services/quotations";

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [quotation, settings, filters] = await Promise.all([
    getQuotationForEditor(id),
    cachedSettings(),
    partFilterOptions(),
  ]);
  // Converted, cancelled or unknown: the detail page says why it can't be changed.
  if (!quotation) redirect(`/quotations/${id}`);

  return (
    <div>
      <PageHeader title={`Edit ${quotation.number}`} />
      <QuotationEditor
        initialCustomer={quotation.customer}
        quotation={quotation}
        partFilters={filters}
        isAdmin={user.role === "admin"}
        vatRate={settings.vatEnabled ? settings.vatRate : "0"}
        staffCapPct={settings.staffMaxDiscountPct}
        today={colomboDate()}
      />
    </div>
  );
}
