import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Sparepartslk" };

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 border-l-4 border-warning pl-4">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Sparepartslk</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to the counter.</p>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-xs">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
