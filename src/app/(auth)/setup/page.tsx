import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cachedBusinessName } from "@/server/cached";
import { companyExists, setupKeyState } from "@/server/services/setup";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `Set up · ${await cachedBusinessName()}`, robots: { index: false } };
}

/** One-time setup for a new company's empty database. Closed for good once any login exists. */
export default async function SetupPage() {
  if (await companyExists()) redirect("/login");
  const name = await cachedBusinessName();
  const locked = setupKeyState() === "missing";

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 border-l-4 border-warning pl-4">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Set up {name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Name the business and make the owner&apos;s login.</p>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-xs">
          {locked ? (
            <p role="status" className="text-sm">
              Setup is locked. Put a SETUP_KEY of at least 24 characters in the stack settings, then reload this page.
            </p>
          ) : (
            <SetupForm />
          )}
        </div>
      </div>
    </main>
  );
}
