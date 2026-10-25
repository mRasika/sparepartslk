"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { createCustomer, updateCustomer, type CustomerInput } from "@/server/services/customers";

export async function createCustomerAction(input: CustomerInput) {
  return runAction(async () => {
    const result = await createCustomer(await requireUser(), input);
    revalidatePath("/customers");
    return result;
  });
}

export async function updateCustomerAction(id: string, input: CustomerInput) {
  return runAction(async () => {
    await updateCustomer(await requireUser(), id, input);
    revalidatePath("/customers", "layout");
    return { id };
  });
}
