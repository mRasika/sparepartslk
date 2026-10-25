"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { discardInvoiceDraft, previewAndSaveDraft } from "@/server/services/invoice-drafts";
import { createInvoice, previewInvoice, type InvoiceInput } from "@/server/services/invoicing";

/** Live totals; with `draftId`, the same call auto-saves the draft. */
export async function previewInvoiceAction(input: InvoiceInput, draftId?: string) {
  return runAction(async () => {
    const user = await requireUser();
    return draftId ? previewAndSaveDraft(user, input, draftId) : previewInvoice(user, input);
  });
}

export async function discardInvoiceDraftAction(id: string) {
  return runAction(async () => discardInvoiceDraft(await requireUser(), id));
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
