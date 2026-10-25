"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { createInvoice, previewInvoice, type InvoiceInput } from "@/server/services/invoicing";

export async function previewInvoiceAction(input: InvoiceInput) {
  return runAction(async () => previewInvoice(await requireUser(), input));
}

export async function createInvoiceAction(input: InvoiceInput) {
  return runAction(async () => {
    const result = await createInvoice(await requireUser(), input);
    revalidatePath("/invoices");
    revalidatePath("/parts", "layout");
    revalidatePath("/stock", "layout");
    revalidatePath("/low-stock");
    return result;
  });
}
