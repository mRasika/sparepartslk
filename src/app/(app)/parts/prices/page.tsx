import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { cachedBrands, cachedCategories, cachedPriceTiers } from "@/server/cached";
import { BulkPriceForm } from "./bulk-price-form";

export default async function BulkPricesPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess what="price changes" />;
  const [tiers, categories, brands] = await Promise.all([cachedPriceTiers(), cachedCategories(), cachedBrands()]);

  return (
    <div>
      <PageHeader
        title="Change prices in bulk"
        description="Raise or lower typed prices by a percent, for a whole tier or one category or brand. Check the preview, then apply."
      />
      <BulkPriceForm
        tiers={tiers.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      />
    </div>
  );
}
