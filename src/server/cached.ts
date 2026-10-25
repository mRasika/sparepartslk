import { revalidateTag, unstable_cache } from "next/cache";
import { listBrands, listCategories, listPriceTiers, listVehicleModels } from "@/server/services/catalog";
import { getSettings } from "@/server/services/settings";

/**
 * Reference lists that change a few times a month but are read on most pages. Served from Next's
 * data cache so a page view doesn't cost a database query each; every write to them through the app
 * calls `refreshCatalogRefs()`. Pages use these; services and tests keep reading the database directly.
 *
 * Entries also expire after 10 minutes, so changes made outside the app (SQL, seed scripts, a data
 * wipe) show up on their own. Cached values round-trip through JSON: no Dates in these rows.
 */
const CATALOG_REFS = "catalog-refs";
const REVALIDATE_SECONDS = 600;
const catalogCache = { tags: [CATALOG_REFS], revalidate: REVALIDATE_SECONDS };

export const cachedCategories = unstable_cache(listCategories, ["categories"], catalogCache);
export const cachedBrands = unstable_cache(listBrands, ["brands"], catalogCache);
export const cachedVehicleModels = unstable_cache(listVehicleModels, ["vehicle-models"], catalogCache);
export const cachedPriceTiers = unstable_cache(listPriceTiers, ["price-tiers"], catalogCache);

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

const SETTINGS = "settings";

/**
 * The settings row for pages that only display it (new invoice, new customer). Saving settings
 * calls `refreshSettings()`. Anything that writes documents reads the row fresh in its transaction.
 * Its `updatedAt` comes back as a string, so don't use it from here.
 */
export const cachedSettings = unstable_cache(() => getSettings(), ["settings"], {
  tags: [SETTINGS],
  revalidate: REVALIDATE_SECONDS,
});

export function refreshSettings() {
  revalidateTag(SETTINGS);
}
