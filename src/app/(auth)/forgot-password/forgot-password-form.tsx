"use client";

import { MailCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestCodeAction,
  resetPasswordAction,
  type RequestCodeState,
  type ResetPasswordState,
} from "./actions";

/** Step 1 asks for the login email; step 2 (same page) takes the code and the new password. */
export function ForgotPasswordForm({ sentAnswer }: { sentAnswer: string }) {
  const [request, requestAction, requesting] = useActionState<RequestCodeState, FormData>(requestCodeAction, {});
  const [reset, resetAction, saving] = useActionState<ResetPasswordState, FormData>(resetPasswordAction, {});
  const [email, setEmail] = useState("");
  const [values, setValues] = useState({ code: "", newPassword: "", confirmPassword: "" });
  const [step, setStep] = useState<1 | 2>(1);
  const [lastAt, setLastAt] = useState<number | undefined>();

  // Move to step 2 each time a code request comes back (also after "Send a new code").
  if (request.sent && request.at !== lastAt) {
    setLastAt(request.at);
    setStep(2);
    if (lastAt !== undefined) setValues((v) => ({ ...v, code: "" }));
  }

  if (step === 1) {
    return (
      <form action={requestAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
        {request.error && (
          <p role="alert" className="text-sm text-destructive">
            {request.error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={requesting} className="mt-1">
          {requesting ? "Sending…" : "Send code"}
        </Button>
      </form>
    );
  }

  const fieldError = (field: string) => (reset.error && reset.field === field ? reset.error : null);
  const codeError = reset.error && !reset.field ? reset.error : null;

  return (
    <div className="flex flex-col gap-5">
      <p role="status" className="flex gap-2 rounded-md bg-muted px-3 py-2 text-sm">
        <MailCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>{sentAnswer}</span>
      </p>
      <form action={resetAction} className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            className="font-mono tracking-widest"
            value={values.code}
            onChange={(e) => setValues((v) => ({ ...v, code: e.target.value }))}
            aria-invalid={Boolean(codeError)}
            aria-describedby={codeError ? "code-error" : undefined}
            required
            autoFocus
          />
          {codeError && (
            <p id="code-error" role="alert" className="text-sm text-destructive">
              {codeError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={values.newPassword}
            onChange={(e) => setValues((v) => ({ ...v, newPassword: e.target.value }))}
            aria-invalid={Boolean(fieldError("newPassword"))}
            aria-describedby="newPassword-hint"
            required
          />
          <p id="newPassword-hint" className={fieldError("newPassword") ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
            {fieldError("newPassword") ?? "At least 8 characters."}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">New password again</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={(e) => setValues((v) => ({ ...v, confirmPassword: e.target.value }))}
            aria-invalid={Boolean(fieldError("confirmPassword"))}
            aria-describedby={fieldError("confirmPassword") ? "confirmPassword-error" : undefined}
            required
          />
          {fieldError("confirmPassword") && (
            <p id="confirmPassword-error" role="alert" className="text-sm text-destructive">
              {fieldError("confirmPassword")}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" disabled={saving} className="mt-1">
          {saving ? "Saving…" : "Save new password"}
        </Button>
      </form>
      <div className="flex flex-col gap-2 border-t pt-4 text-sm text-muted-foreground">
        <p>No email? Look in junk mail, or ask the admin to reset your password.</p>
        <div className="flex flex-wrap gap-2">
          <form action={requestAction}>
            <input type="hidden" name="email" value={email} />
            <Button type="submit" variant="secondary" size="sm" disabled={requesting}>
              {requesting ? "Sending…" : "Send a new code"}
            </Button>
          </form>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep(1)}>
            Use a different email
          </Button>
        </div>
      </div>
    </div>
  );
}
