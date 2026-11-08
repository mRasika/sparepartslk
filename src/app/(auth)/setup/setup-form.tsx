"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setupAction, type SetupState } from "./actions";

type FieldProps = { name: string; label: string; type?: string; autoComplete?: string; state: SetupState; autoFocus?: boolean };

function Field({ name, label, type = "text", autoComplete, state, autoFocus }: FieldProps) {
  const error = state.field === name ? state.error : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={state.values?.[name]}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        required
        autoFocus={autoFocus}
      />
      {error && (
        <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SetupForm() {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(setupAction, {});
  const general = state.error && !state.field ? state.error : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {general && (
        <p role="alert" className="text-sm text-destructive">
          {general}
        </p>
      )}
      <Field name="setupKey" label="Setup key" type="password" autoComplete="off" state={state} autoFocus />
      <Field name="businessName" label="Business name" autoComplete="organization" state={state} />
      <Field name="ownerName" label="Your name" autoComplete="name" state={state} />
      <Field name="email" label="Email" type="email" autoComplete="username" state={state} />
      <Field name="password" label="Password" type="password" autoComplete="new-password" state={state} />
      <Field name="confirmPassword" label="Password again" type="password" autoComplete="new-password" state={state} />
      <Button type="submit" size="lg" disabled={pending} className="mt-1">
        {pending ? "Setting up…" : "Set up"}
      </Button>
    </form>
  );
}
