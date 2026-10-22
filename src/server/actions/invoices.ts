"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { NotFound } from "@/server/errors";
import { searchParts } from "@/server/services/catalog";
import { createInvoice, previewInvoice, type InvoiceInput } from "@/server/services/invoicing";
import { lookupPrices } from "@/server/services/pricing";

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

/** Active parts with the price this customer would pay (blank when the part has no price). */
export async function searchPartsForCustomerAction(q: string, customerId: string) {
  return runAction(async () => {
    await requireUser();
    const [customer] = await db
      .select({ tierId: customers.tierId })
      .from(customers)
      .where(eq(customers.id, customerId));
    if (!customer) throw new NotFound("Customer not found");
    const rows = await searchParts(q, { activeOnly: true, limit: 12 });
    const prices = await lookupPrices(db, customer.tierId, rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, price: prices.get(r.id) }));
  });
}
