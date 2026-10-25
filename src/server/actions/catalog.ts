"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import {
  createPart,
  updatePart,
  upsertBrand,
  upsertCategory,
  upsertVehicleModel,
  type PartInput,
} from "@/server/services/catalog";

export async function createPartAction(input: PartInput) {
  return runAction(async () => {
    const user = await requireUser();
    const result = await createPart(user, input);
    revalidatePath("/parts");
    return result;
  });
}

export async function updatePartAction(id: string, input: PartInput) {
  return runAction(async () => {
    const user = await requireUser();
    await updatePart(user, id, input);
    revalidatePath("/parts");
    revalidatePath(`/parts/${id}`);
    return { id };
  });
}

export async function upsertCategoryAction(input: { id?: string; name: string }) {
  return runAction(async () => {
    const result = await upsertCategory(await requireUser(), input);
    revalidatePath("/parts", "layout");
    return result;
  });
}

export async function upsertBrandAction(input: { id?: string; name: string }) {
  return runAction(async () => {
    const result = await upsertBrand(await requireUser(), input);
    revalidatePath("/parts", "layout");
    return result;
  });
}

export async function upsertVehicleModelAction(input: {
  id?: string;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
}) {
  return runAction(async () => {
    const result = await upsertVehicleModel(await requireUser(), input);
    revalidatePath("/parts", "layout");
    return result;
  });
}
