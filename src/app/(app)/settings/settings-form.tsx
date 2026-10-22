"use client";

/* eslint-disable @next/next/no-img-element -- previewing an uploaded logo URL */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/action-result";
import { updateSettingsAction, uploadLogoAction } from "@/server/actions/settings";

type Values = {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  tin: string;
  vatEnabled: boolean;
  vatRate: string;
  staffMaxDiscountPct: string;
  defaultCreditDays: string;
  docPrefix: string;
  logoUrl: string | null;
};

export function SettingsForm({ initial }: { initial: Values }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((s) => ({ ...s, [k]: val }));
  const err = (f: string) => (error?.field === f ? error.message : undefined);

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.set("logo", file);
    const result = await uploadLogoAction(fd);
    setUploading(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    set("logoUrl", result.data.url);
    toast.success("Logo uploaded. Save to keep it.");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateSettingsAction({ ...v, defaultCreditDays: Number(v.defaultCreditDays) });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error.message);
        return;
      }
      toast.success("Settings saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-semibold sm:col-span-2">Business details</h2>
        <Field id="businessName" label="Business name" error={err("businessName")}>
          <Input id="businessName" required value={v.businessName} onChange={(e) => set("businessName", e.target.value)} />
        </Field>
        <Field id="tin" label="TIN" hint="Printed on every invoice when filled in.">
          <Input id="tin" value={v.tin} onChange={(e) => set("tin", e.target.value)} />
        </Field>
        <Field id="phone" label="Phone">
          <Input id="phone" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field id="email" label="Email" error={err("email")}>
          <Input id="email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="address" label="Address">
            <Textarea id="address" rows={2} value={v.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center gap-4 sm:col-span-2">
          {v.logoUrl ? (
            <img src={v.logoUrl} alt="Current logo" className="h-14 w-auto rounded border bg-white object-contain p-1" />
          ) : (
            <div className="grid h-14 w-24 place-items-center rounded border border-dashed text-xs text-muted-foreground">No logo</div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="logo">Logo (PNG, JPG or WebP, under 1 MB)</Label>
            <Input
              id="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </div>
          {v.logoUrl && (
            <Button type="button" variant="ghost" onClick={() => set("logoUrl", null)}>
              Remove logo
            </Button>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="text-base font-semibold">VAT</h2>
          <p className="text-sm text-muted-foreground">
            With VAT on, invoices are titled TAX INVOICE and show both TINs. Existing invoices keep the rate they were issued with.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox checked={v.vatEnabled} onCheckedChange={(c) => set("vatEnabled", Boolean(c))} />
          Charge VAT on new invoices
        </label>
        <Field id="vatRate" label="VAT rate (%)" error={err("vatRate")}>
          <Input id="vatRate" inputMode="decimal" disabled={!v.vatEnabled} value={v.vatRate} onChange={(e) => set("vatRate", e.target.value)} />
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <h2 className="text-base font-semibold sm:col-span-3">Rules</h2>
        <Field id="staffMaxDiscountPct" label="Staff discount limit (%)" error={err("staffMaxDiscountPct")}>
          <Input id="staffMaxDiscountPct" inputMode="decimal" value={v.staffMaxDiscountPct} onChange={(e) => set("staffMaxDiscountPct", e.target.value)} />
        </Field>
        <Field id="defaultCreditDays" label="Default credit days" error={err("defaultCreditDays")}>
          <Input id="defaultCreditDays" type="number" min={0} value={v.defaultCreditDays} onChange={(e) => set("defaultCreditDays", e.target.value)} />
        </Field>
        <Field id="docPrefix" label="Document prefix" hint="Optional, e.g. SP gives SP-INV-2026-000001." error={err("docPrefix")}>
          <Input id="docPrefix" maxLength={6} value={v.docPrefix} onChange={(e) => set("docPrefix", e.target.value.toUpperCase())} />
        </Field>
      </section>

      {error && !error.field && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" disabled={pending || uploading}>
          {pending ? "Saving…" : "Save settings"}
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
      {error ? <p className="text-sm text-destructive">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
