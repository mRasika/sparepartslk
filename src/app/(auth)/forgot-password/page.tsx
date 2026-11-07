import type { Metadata } from "next";
import Link from "next/link";
import { CODE_SENT_ANSWER } from "@/lib/reset-code";
import { emailIsSetUp } from "@/server/email";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password · Sparepartslk", robots: { index: false } };

export default function ForgotPasswordPage() {
  const canEmail = emailIsSetUp();
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 border-l-4 border-warning pl-4">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Forgot password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canEmail ? "We email a code to the address you sign in with." : "Ask the admin to reset your password."}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-xs">
          {canEmail ? (
            <ForgotPasswordForm sentAnswer={CODE_SENT_ANSWER} />
          ) : (
            <p className="text-sm">
              The admin can set a new password for you on the Users page. You&apos;ll be signed out of every device
              when they do.
            </p>
          )}
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
