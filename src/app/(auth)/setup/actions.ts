"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refreshSettings } from "@/server/cached";
import { requestIp } from "@/server/request-ip";
import { setupCompany } from "@/server/services/setup";
import { signIn } from "@/server/services/sign-in";

export type SetupState = { error?: string; field?: string; values?: Record<string, string> };

/** The one-time company setup. On success the owner is signed in and lands on the dashboard. */
export async function setupAction(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const text = (name: string) => String(formData.get(name) ?? "");
  const input = {
    setupKey: text("setupKey"),
    businessName: text("businessName"),
    ownerName: text("ownerName"),
    email: text("email"),
    password: text("password"),
    confirmPassword: text("confirmPassword"),
  };
  const requestHeaders = await headers();
  const ip = requestIp(requestHeaders);
  const result = await setupCompany(input, { ip });
  if (!result.ok) {
    // Never send the key or passwords back to the browser.
    const values = { businessName: input.businessName, ownerName: input.ownerName, email: input.email };
    return { error: result.message, field: result.field, values };
  }

  refreshSettings();
  const signedIn = await signIn({ email: result.email, password: input.password, ip, headers: requestHeaders });
  redirect(signedIn.ok ? "/dashboard" : "/login");
}
