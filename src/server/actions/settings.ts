"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireRole, requireUser } from "@/server/auth";
import { refreshSettings } from "@/server/cached";
import { DomainError } from "@/server/errors";
import { updateSettings, type SettingsInput } from "@/server/services/settings";
import { createSupabaseAdminClient } from "@/server/supabase";

export async function updateSettingsAction(input: SettingsInput) {
  return runAction(async () => {
    await updateSettings(await requireUser(), input);
    refreshSettings();
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const BUCKET = "branding";

/** Uploads the business logo to the public `branding` bucket and returns its URL (saved with the settings form). */
export async function uploadLogoAction(formData: FormData) {
  return runAction(async () => {
    requireRole(await requireUser(), "admin");
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("Validation", "Choose an image", { field: "logo" });
    const ext = LOGO_TYPES[file.type];
    if (!ext) throw new DomainError("Validation", "Use a PNG, JPG or WebP image", { field: "logo" });
    if (file.size > 1024 * 1024) throw new DomainError("Validation", "Keep the logo under 1 MB", { field: "logo" });

    const supabase = createSupabaseAdminClient();
    // Creating an existing bucket just returns an error we can ignore.
    await supabase.storage.createBucket(BUCKET, { public: true });
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
    if (error) throw new DomainError("UploadFailed", `Logo upload failed: ${error.message}`, { field: "logo" });
    return { url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  });
}
