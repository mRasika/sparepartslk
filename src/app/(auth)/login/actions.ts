"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loadActiveUser } from "@/server/auth";
import { createSupabaseServerClient } from "@/server/supabase";

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message, email };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: "Email or password is incorrect", email };

  const user = await loadActiveUser(data.user.id);
  if (!user) {
    await supabase.auth.signOut();
    return { error: "This account is turned off. Ask the owner to turn it back on.", email };
  }

  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
