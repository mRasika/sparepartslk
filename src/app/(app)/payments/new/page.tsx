import { PageHeader } from "@/components/page-header";
import { colomboDate } from "@/lib/dates";
import { requireUser } from "@/server/auth";
import { getCustomer } from "@/server/services/customers";
import { PaymentForm } from "./payment-form";

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const user = await requireUser();
  const { customerId } = await searchParams;
  const customer = customerId ? await getCustomer(customerId).catch(() => null) : null;

  return (
    <div>
      <PageHeader title="Receive payment" description="Money from a customer towards their invoices." />
      <PaymentForm initialCustomer={customer} isAdmin={user.role === "admin"} today={colomboDate()} />
    </div>
  );
}
