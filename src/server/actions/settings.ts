"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireUser } from "@/server/auth";
import { refreshSettings } from "@/server/cached";
import { DomainError } from "@/server/errors";
import { updateSettings, type SettingsInput } from "@/server/services/settings";
import { saveLogo } from "@/server/services/logo";

export async function updateSettingsAction(input: SettingsInput) {
  return runAction(async () => {
    await updateSettings(await requireUser(), input);
    refreshSettings();
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

/** Stores the business logo in the database and returns its address (saved with the settings form). */
export async function uploadLogoAction(formData: FormData) {
  return runAction(async () => {
    const user = await requireUser();
    const file = formData.get("logo");
    if (!(file instanceof File)) throw new DomainError("Validation", "Choose an image", { field: "logo" });
    return saveLogo(user, { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  });
}
