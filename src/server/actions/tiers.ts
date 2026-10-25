"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { refreshCatalogRefs } from "@/server/cached";
import {
  applyBulkPriceChange,
  createTier,
  previewBulkPriceChange,
  updateTier,
  type BulkChangeInput,
  type TierInput,
} from "@/server/services/tiers";

export async function createTierAction(input: TierInput) {
  return runAction(async () => {
    const result = await createTier(await requireUser(), input);
    refreshCatalogRefs();
    revalidatePath("/settings/tiers");
    return result;
  });
}

export async function updateTierAction(id: string, input: TierInput) {
  return runAction(async () => {
    await updateTier(await requireUser(), id, input);
    refreshCatalogRefs();
    revalidatePath("/settings/tiers");
    return { id };
  });
}

export async function previewBulkPriceChangeAction(input: BulkChangeInput) {
  return runAction(async () => previewBulkPriceChange(await requireUser(), input));
}

export async function applyBulkPriceChangeAction(input: BulkChangeInput) {
  return runAction(async () => {
    const result = await applyBulkPriceChange(await requireUser(), input);
    revalidatePath("/parts", "layout");
    revalidatePath("/settings/tiers");
    return result;
  });
}
