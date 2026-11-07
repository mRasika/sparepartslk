"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser, type Role } from "@/server/auth";
import {
  createUser,
  setCanGetEmails,
  setUserActive,
  setUserPassword,
  setUserRole,
  type NewUserInput,
} from "@/server/services/users";

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

export async function setCanGetEmailsAction(userId: string, on: boolean) {
  return runAction(async () => {
    await setCanGetEmails(await requireUser(), userId, on);
    revalidatePath("/users");
    return { ok: true };
  });
}

export async function setUserPasswordAction(userId: string, password: string) {
  return runAction(async () => {
    await setUserPassword(await requireUser(), userId, password);
    return { ok: true };
  });
}
