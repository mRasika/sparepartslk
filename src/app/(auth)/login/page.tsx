import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { companyExists } from "@/server/services/setup";
import { cachedBusinessName } from "@/server/cached";
import { emailIsSetUp } from "@/server/email";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `Sign in · ${await cachedBusinessName()}` };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  // A new company's empty database: the first visitor is sent on to the one-time setup.
  if (!(await companyExists())) redirect("/setup");
  const { reset } = await searchParams;
  const name = await cachedBusinessName();
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 border-l-4 border-warning pl-4">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">{name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to the counter.</p>
        </div>
        {reset === "done" && (
          <p role="status" className="mb-4 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
            Password changed. Sign in with the new one.
          </p>
        )}
        <div className="rounded-lg border bg-card p-6 shadow-xs">
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {emailIsSetUp() ? (
            <Link href="/forgot-password" className="underline-offset-4 hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          ) : (
            "Forgot your password? Ask the admin to reset it."
          )}
        </p>
      </div>
    </main>
  );
}
