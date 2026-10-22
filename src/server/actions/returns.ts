"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { createReturn, type ReturnInput } from "@/server/services/returns";

export async function createReturnAction(input: ReturnInput) {
  return runAction(async () => {
    const result = await createReturn(await requireUser(), input);
    revalidatePath("/returns");
    revalidatePath("/invoices", "layout");
    revalidatePath("/customers", "layout");
    revalidatePath("/payments");
    revalidatePath("/parts", "layout");
    revalidatePath("/stock", "layout");
    revalidatePath("/low-stock");
    return result;
  });
}
