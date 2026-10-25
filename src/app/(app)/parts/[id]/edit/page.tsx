import { PartForm } from "@/components/forms/part-form";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { cachedBrands, cachedCategories, cachedPriceTiers, cachedVehicleModels } from "@/server/cached";
import { getPart } from "@/server/services/catalog";

export default async function EditPartPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess what="part editing" />;
  const { id } = await params;

  const [part, tiers, categories, brands, vehicleModels] = await Promise.all([
    getPart(user, id),
    cachedPriceTiers(),
    cachedCategories(),
    cachedBrands(),
    cachedVehicleModels(),
  ]);

  return (
    <div>
      <PageHeader title={`Edit ${part.sku}`} description="Stock and cost change only through GRNs, sales and adjustments." />
      <PartForm
        partId={part.id}
        initial={{
          sku: part.sku,
          name: part.name,
          keywords: part.keywords ?? "",
          oemPartNo: part.oemPartNo ?? "",
          barcode: part.barcode ?? "",
          categoryId: part.categoryId ?? "",
          brandId: part.brandId ?? "",
          unit: part.unit,
          binLocation: part.binLocation ?? "",
          reorderLevel: String(part.reorderLevel),
          reorderQty: String(part.reorderQty),
          isActive: part.isActive,
          prices: Object.fromEntries(part.prices.map((p) => [p.tierId, p.price])),
          fitmentIds: part.fitments.map((f) => f.vehicleModelId),
        }}
        tiers={tiers}
        categories={categories}
        brands={brands}
        vehicleModels={vehicleModels}
      />
    </div>
  );
}
