"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser, type Role } from "@/server/auth";
import { createUser, setUserActive, setUserRole, type NewUserInput } from "@/server/services/users";

export async function createUserAction(input: NewUserInput) {
  return runAction(async () => {
    const result = await createUser(await requireUser(), input);
    revalidatePath("/users");
    return result;
  });
}

export async function setUserActiveAction(userId: string, active: boolean) {
  return runAction(async () => {
    await setUserActive(await requireUser(), userId, active);
    revalidatePath("/users");
    return { ok: true };
  });
}

export async function setUserRoleAction(userId: string, role: Role) {
  return runAction(async () => {
    await setUserRole(await requireUser(), userId, role);
    revalidatePath("/users");
    return { ok: true };
  });
}
