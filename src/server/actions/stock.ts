"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { createAdjustment, type AdjustmentInput } from "@/server/services/adjustments";

export async function createAdjustmentAction(input: AdjustmentInput) {
  return runAction(async () => {
    const result = await createAdjustment(await requireUser(), input);
    revalidatePath("/stock", "layout");
    revalidatePath("/low-stock");
    revalidatePath("/parts", "layout");
    return result;
  });
}
