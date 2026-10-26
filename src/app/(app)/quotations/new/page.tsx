import { eq } from "drizzle-orm";
import { QuotationEditor } from "@/components/billing/quotation-editor";
import { PageHeader } from "@/components/page-header";
import { colomboDate } from "@/lib/dates";
import { requireUser } from "@/server/auth";
import { cachedSettings, partFilterOptions } from "@/server/cached";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { getCustomer, type CustomerRow } from "@/server/services/customers";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await requireUser();
  const { customerId } = await searchParams;
  const [settings, filters] = await Promise.all([cachedSettings(), partFilterOptions()]);

  let customer: CustomerRow | null = null;
  if (customerId) {
    customer = await getCustomer(customerId).catch(() => null);
    if (customer && !customer.isActive) customer = null;
  }
  if (!customer) {
    const [walkIn] = await db.select({ id: customers.id }).from(customers).where(eq(customers.isWalkIn, true));
    customer = await getCustomer(walkIn.id);
  }

  return (
    <div>
      <PageHeader title="New quotation" />
      <QuotationEditor
        initialCustomer={customer}
        partFilters={filters}
        isAdmin={user.role === "admin"}
        vatRate={settings.vatEnabled ? settings.vatRate : "0"}
        staffCapPct={settings.staffMaxDiscountPct}
        today={colomboDate()}
      />
    </div>
  );
}
