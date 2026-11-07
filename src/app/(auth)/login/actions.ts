"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/server/better-auth";
import { requestIp } from "@/server/request-ip";
import { signIn } from "@/server/services/sign-in";

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  // Trimmed before the check, so an email pasted with a space still signs in.
  email: z.string().trim().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password"),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message, email };

  const requestHeaders = await headers();
  const result = await signIn({ ...parsed.data, ip: requestIp(requestHeaders), headers: requestHeaders });
  if (!result.ok) return { error: result.error, email };

  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() }).catch((e) => console.error("Sign-out failed", e));
  redirect("/login");
}
