"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/action-result";
import { createCustomerAction, updateCustomerAction } from "@/server/actions/customers";

export type CustomerFormValues = {
  name: string;
  businessName: string;
  phone: string;
  address: string;
  tin: string;
  tierId: string;
  creditLimit: string;
  creditDays: string;
  isActive: boolean;
};

export function CustomerForm({
  customerId,
  initial,
  tiers,
  isAdmin,
  isWalkIn = false,
}: {
  customerId?: string;
  initial: CustomerFormValues;
  tiers: { id: string; name: string }[];
  isAdmin: boolean;
  isWalkIn?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof CustomerFormValues>(k: K, v: CustomerFormValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));
  const termsLocked = !isAdmin || isWalkIn;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = customerId
        ? await updateCustomerAction(customerId, values)
        : await createCustomerAction(values);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error.message);
        return;
      }
      toast.success(customerId ? "Customer saved" : "Customer added");
      router.push(`/customers/${result.data.id}`);
    });
  }

  const err = (field: string) => (error?.field === field ? error.message : undefined);

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-semibold sm:col-span-2">Contact</h2>
        <Field id="name" label="Name" error={err("name")}>
          <Input id="name" required value={values.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id="businessName" label="Business name">
          <Input id="businessName" value={values.businessName} onChange={(e) => set("businessName", e.target.value)} />
        </Field>
        <Field id="phone" label="Phone">
          <Input id="phone" type="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field id="tin" label="TIN" hint="Printed on tax invoices when VAT is on.">
          <Input id="tin" value={values.tin} onChange={(e) => set("tin", e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="address" label="Address">
            <Textarea id="address" rows={2} value={values.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <h2 className="text-base font-semibold">Pricing and credit</h2>
          {termsLocked && (
            <p className="text-sm text-muted-foreground">
              {isWalkIn ? "The walk-in customer always pays cash at the default price." : "Only an admin can change these."}
            </p>
          )}
        </div>
        <Field id="tierId" label="Price tier">
          <NativeSelect
            id="tierId"
            className="w-full"
            value={values.tierId}
            disabled={termsLocked}
            onChange={(e) => set("tierId", e.target.value)}
          >
            {tiers.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field id="creditLimit" label="Credit limit (Rs)" hint="0 means cash only." error={err("creditLimit")}>
          <Input
            id="creditLimit"
            inputMode="decimal"
            className="tabular-nums"
            disabled={termsLocked}
            value={values.creditLimit}
            onChange={(e) => set("creditLimit", e.target.value)}
          />
        </Field>
        <Field id="creditDays" label="Credit days" error={err("creditDays")}>
          <Input
            id="creditDays"
            type="number"
            min={0}
            disabled={termsLocked}
            value={values.creditDays}
            onChange={(e) => set("creditDays", e.target.value)}
          />
        </Field>
      </section>

      {!isWalkIn && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={values.isActive} onCheckedChange={(c) => set("isActive", Boolean(c))} />
          Active (inactive customers can’t be invoiced)
        </label>
      )}

      {error && !error.field && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : customerId ? "Save customer" : "Add customer"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
