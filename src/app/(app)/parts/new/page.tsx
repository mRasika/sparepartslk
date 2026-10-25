import { emptyPartValues, PartForm } from "@/components/forms/part-form";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { cachedBrands, cachedCategories, cachedPriceTiers, cachedVehicleModels } from "@/server/cached";

export default async function NewPartPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess what="new parts" />;

  const [tiers, categories, brands, vehicleModels] = await Promise.all([
    cachedPriceTiers(),
    cachedCategories(),
    cachedBrands(),
    cachedVehicleModels(),
  ]);

  return (
    <div>
      <PageHeader title="New part" description="Stock starts at 0. Receive goods with a GRN to add stock." />
      <PartForm
        initial={emptyPartValues}
        tiers={tiers}
        categories={categories}
        brands={brands}
        vehicleModels={vehicleModels}
      />
    </div>
  );
}
