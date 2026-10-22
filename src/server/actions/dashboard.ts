"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { resolveReconciliationIssue } from "@/server/services/dashboard";

export async function resolveReconciliationIssueAction(issueId: string) {
  return runAction(async () => {
    await resolveReconciliationIssue(await requireUser(), issueId);
    revalidatePath("/dashboard");
    return { ok: true };
  });
}
