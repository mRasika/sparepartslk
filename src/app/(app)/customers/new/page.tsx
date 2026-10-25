import { CustomerForm } from "@/components/forms/customer-form";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { cachedPriceTiers, cachedSettings } from "@/server/cached";

export default async function NewCustomerPage() {
  const user = await requireUser();
  const [tiers, settings] = await Promise.all([cachedPriceTiers(), cachedSettings()]);
  const defaultTier = tiers.find((t) => t.isDefault) ?? tiers[0];

  return (
    <div>
      <PageHeader title="Add customer" />
      <CustomerForm
        isAdmin={user.role === "admin"}
        tiers={tiers}
        initial={{
          name: "",
          businessName: "",
          phone: "",
          address: "",
          tin: "",
          tierId: defaultTier.id,
          creditLimit: "0.00",
          creditDays: String(settings.defaultCreditDays),
          isActive: true,
        }}
      />
    </div>
  );
}
