import { revalidateTag, unstable_cache } from "next/cache";
import { listBrands, listCategories, listPriceTiers, listVehicleModels } from "@/server/services/catalog";

/**
 * Reference lists that change a few times a month but are read on most pages. Served from Next's
 * data cache so a page view doesn't cost a database query each; every write to them calls
 * `refreshCatalogRefs()`. Pages use these; services and tests keep reading the database directly.
 */
const CATALOG_REFS = "catalog-refs";

export const cachedCategories = unstable_cache(listCategories, ["categories"], { tags: [CATALOG_REFS] });
export const cachedBrands = unstable_cache(listBrands, ["brands"], { tags: [CATALOG_REFS] });
export const cachedVehicleModels = unstable_cache(listVehicleModels, ["vehicle-models"], { tags: [CATALOG_REFS] });
export const cachedPriceTiers = unstable_cache(listPriceTiers, ["price-tiers"], { tags: [CATALOG_REFS] });

/** The part finder's category and bike lists, trimmed to what it shows. */
export async function partFilterOptions() {
  const [categories, vehicleModels] = await Promise.all([cachedCategories(), cachedVehicleModels()]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    vehicleModels: vehicleModels.map((m) => ({ id: m.id, label: m.label })),
  };
}

export function refreshCatalogRefs() {
  revalidateTag(CATALOG_REFS);
}
