import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/forms/customer-form";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { cachedPriceTiers } from "@/server/cached";
import { getCustomer, type CustomerRow } from "@/server/services/customers";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let customer: CustomerRow;
  try {
    customer = await getCustomer(id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const tiers = await cachedPriceTiers();

  return (
    <div>
      <PageHeader title={`Edit ${customer.name}`} />
      <CustomerForm
        customerId={customer.id}
        isAdmin={user.role === "admin"}
        isWalkIn={customer.isWalkIn}
        tiers={tiers}
        initial={{
          name: customer.name,
          businessName: customer.businessName ?? "",
          phone: customer.phone ?? "",
          address: customer.address ?? "",
          tin: customer.tin ?? "",
          tierId: customer.tierId,
          creditLimit: customer.creditLimit,
          creditDays: String(customer.creditDays),
          isActive: customer.isActive,
        }}
      />
    </div>
  );
}
