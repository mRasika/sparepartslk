"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import {
  addClosedDay,
  removeClosedDay,
  saveSalesTarget,
  type ClosedDayInput,
  type SalesTargetInput,
} from "@/server/services/sales-targets";

function revalidate() {
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function saveSalesTargetAction(input: SalesTargetInput) {
  return runAction(async () => {
    await saveSalesTarget(await requireUser(), input);
    revalidate();
    return { ok: true };
  });
}

export async function addClosedDayAction(input: ClosedDayInput) {
  return runAction(async () => {
    await addClosedDay(await requireUser(), input);
    revalidate();
    return { ok: true };
  });
}

export async function removeClosedDayAction(day: string) {
  return runAction(async () => {
    await removeClosedDay(await requireUser(), day);
    revalidate();
    return { ok: true };
  });
}
