"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import {
  cancelQuotation,
  createQuotation,
  previewQuotation,
  updateQuotation,
  type QuotationInput,
} from "@/server/services/quotations";

/** Live totals for the editor; nothing is saved. */
export async function previewQuotationAction(input: QuotationInput) {
  return runAction(async () => previewQuotation(await requireUser(), input));
}

export async function createQuotationAction(input: QuotationInput) {
  return runAction(async () => {
    const result = await createQuotation(await requireUser(), input);
    revalidatePath("/quotations");
    return result;
  });
}

export async function updateQuotationAction(id: string, input: QuotationInput) {
  return runAction(async () => {
    await updateQuotation(await requireUser(), id, input);
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
  });
}

export async function cancelQuotationAction(id: string, reason: string) {
  return runAction(async () => {
    await cancelQuotation(await requireUser(), id, reason);
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
  });
}
