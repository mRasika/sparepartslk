"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { customerBalance, outstandingInvoices } from "@/server/services/customers";
import { db } from "@/server/db/client";
import { cancelInvoice } from "@/server/services/invoicing";
import { receivePayment, type PaymentInput } from "@/server/services/payments";

export async function receivePaymentAction(input: PaymentInput) {
  return runAction(async () => {
    const result = await receivePayment(await requireUser(), input);
    revalidatePath("/payments");
    revalidatePath("/invoices", "layout");
    revalidatePath("/customers", "layout");
    return result;
  });
}

/** Open invoices (oldest due first) and the balance, for the payment form. */
export async function openInvoicesAction(customerId: string) {
  return runAction(async () => {
    await requireUser();
    const [invoices, balance] = await Promise.all([
      outstandingInvoices({ customerId }),
      customerBalance(db, customerId),
    ]);
    return { invoices, balance };
  });
}

export async function cancelInvoiceAction(invoiceId: string, reason: string) {
  return runAction(async () => {
    await cancelInvoice(await requireUser(), invoiceId, reason);
    revalidatePath("/invoices", "layout");
    revalidatePath("/customers", "layout");
    revalidatePath("/payments");
    revalidatePath("/parts", "layout");
    revalidatePath("/stock", "layout");
    revalidatePath("/low-stock");
    return { id: invoiceId };
  });
}
