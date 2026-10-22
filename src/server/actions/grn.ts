"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { createGrn, upsertSupplier, type GrnInput, type SupplierInput } from "@/server/services/grn";

export async function upsertSupplierAction(input: SupplierInput) {
  return runAction(async () => {
    const result = await upsertSupplier(await requireUser(), input);
    revalidatePath("/suppliers");
    return result;
  });
}

export async function createGrnAction(input: GrnInput) {
  return runAction(async () => {
    const result = await createGrn(await requireUser(), input);
    revalidatePath("/grn");
    revalidatePath("/parts", "layout");
    return result;
  });
}
