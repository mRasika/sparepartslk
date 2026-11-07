"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { emailIsSetUp } from "@/server/email";
import { requestIp } from "@/server/request-ip";
import { requestResetCode, resetWithCode } from "@/server/services/password-reset";

export type RequestCodeState = { sent?: boolean; email?: string; error?: string; at?: number };

export async function requestCodeAction(_prev: RequestCodeState, formData: FormData): Promise<RequestCodeState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!z.email().safeParse(email).success) return { error: "Enter your login email", email };
  if (!emailIsSetUp()) return { error: "Ask the admin to reset your password.", email };
  const ip = requestIp(await headers());
  // The lookup and sending run after the reply, so every email gets the same answer just as fast.
  after(() => requestResetCode({ email, ip }));
  return { sent: true, email, at: Date.now() };
}

export type ResetPasswordState = { error?: string; field?: string };

export async function resetPasswordAction(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const value = (name: string) => String(formData.get(name) ?? "");
  const result = await resetWithCode({
    email: value("email"),
    code: value("code"),
    newPassword: value("newPassword"),
    confirmPassword: value("confirmPassword"),
    ip: requestIp(await headers()),
  });
  if (!result.ok) return { error: result.message, field: result.field };
  redirect("/login?reset=done");
}
