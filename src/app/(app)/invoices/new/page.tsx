import { eq } from "drizzle-orm";
import { InvoiceEditor } from "@/components/billing/invoice-editor";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { getCustomer, type CustomerRow } from "@/server/services/customers";
import { getSettings } from "@/server/services/settings";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const user = await requireUser();
  const { customerId } = await searchParams;
  const settings = await getSettings();

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
      <PageHeader title="New invoice" />
      <InvoiceEditor
        initialCustomer={customer}
        isAdmin={user.role === "admin"}
        vatRate={settings.vatEnabled ? settings.vatRate : "0"}
        staffCapPct={settings.staffMaxDiscountPct}
      />
    </div>
  );
}
