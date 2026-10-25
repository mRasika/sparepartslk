"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/action-result";
import { createPartAction, updatePartAction } from "@/server/actions/catalog";

type Option = { id: string; name: string };
type Tier = { id: string; name: string; isDefault: boolean };
type VehicleModel = { id: string; label: string };

export type PartFormValues = {
  sku: string;
  name: string;
  keywords: string;
  oemPartNo: string;
  barcode: string;
  categoryId: string;
  brandId: string;
  unit: string;
  binLocation: string;
  reorderLevel: string;
  reorderQty: string;
  isActive: boolean;
  prices: Record<string, string>;
  fitmentIds: string[];
};

export const emptyPartValues: PartFormValues = {
  sku: "",
  name: "",
  keywords: "",
  oemPartNo: "",
  barcode: "",
  categoryId: "",
  brandId: "",
  unit: "pcs",
  binLocation: "",
  reorderLevel: "0",
  reorderQty: "0",
  isActive: true,
  prices: {},
  fitmentIds: [],
};

export function PartForm({
  partId,
  initial,
  tiers,
  categories,
  brands,
  vehicleModels,
}: {
  partId?: string;
  initial: PartFormValues;
  tiers: Tier[];
  categories: Option[];
  brands: Option[];
  vehicleModels: VehicleModel[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<ActionError | null>(null);
  const [fitmentFilter, setFitmentFilter] = useState("");
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof PartFormValues>(key: K, value: PartFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const shownModels = useMemo(() => {
    const f = fitmentFilter.trim().toLowerCase();
    return f ? vehicleModels.filter((m) => m.label.toLowerCase().includes(f)) : vehicleModels;
  }, [fitmentFilter, vehicleModels]);

  const fieldError = (field: string) => (error?.field === field ? error.message : undefined);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      ...values,
      reorderLevel: values.reorderLevel,
      reorderQty: values.reorderQty,
      prices: tiers
        .filter((t) => values.prices[t.id]?.trim())
        .map((t) => ({ tierId: t.id, price: values.prices[t.id].trim() })),
    };
    startTransition(async () => {
      const result = partId ? await updatePartAction(partId, input) : await createPartAction(input);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error.message);
        return;
      }
      toast.success(partId ? "Part saved" : "Part created");
      router.push(`/parts/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-4xl gap-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-semibold sm:col-span-2">Identity</h2>
        <TextField label="SKU" id="sku" value={values.sku} onChange={(v) => set("sku", v)} error={fieldError("sku")} required />
        <TextField label="Name" id="name" value={values.name} onChange={(v) => set("name", v)} error={fieldError("name")} required />
        <TextField label="OEM part no" id="oemPartNo" value={values.oemPartNo} onChange={(v) => set("oemPartNo", v)} />
        <TextField label="Barcode" id="barcode" value={values.barcode} onChange={(v) => set("barcode", v)} error={fieldError("barcode")} />
        <div className="grid gap-1.5">
          <Label htmlFor="categoryId">Category</Label>
          <NativeSelect id="categoryId" className="w-full" value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <NativeSelectOption value="">None</NativeSelectOption>
            {categories.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="brandId">Brand</Label>
          <NativeSelect id="brandId" className="w-full" value={values.brandId} onChange={(e) => set("brandId", e.target.value)}>
            <NativeSelectOption value="">None</NativeSelectOption>
            {brands.map((b) => (
              <NativeSelectOption key={b.id} value={b.id}>
                {b.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <TextField label="Unit" id="unit" value={values.unit} onChange={(v) => set("unit", v)} />
        <TextField label="Bin location" id="binLocation" value={values.binLocation} onChange={(v) => set("binLocation", v)} />
        <div className="grid gap-1.5 sm:col-span-2">
          <TextField
            label="Keywords"
            id="keywords"
            value={values.keywords}
            onChange={(v) => set("keywords", v)}
            error={fieldError("keywords")}
            placeholder="e.g. pad set, brake liner, LMP-4471"
            aria-describedby="keywords-hint"
          />
          <p id="keywords-hint" className="text-xs text-muted-foreground">
            Other names customers use, supplier and cross-reference numbers. Search finds the part by any of these.
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="text-base font-semibold">Reordering</h2>
          <p className="text-sm text-muted-foreground">
            The part shows on Low stock when on-hand drops to the reorder level. Leave the level at 0 to never flag it.
          </p>
        </div>
        <TextField label="Reorder level" id="reorderLevel" type="number" min={0} value={values.reorderLevel} onChange={(v) => set("reorderLevel", v)} error={fieldError("reorderLevel")} />
        <TextField label="Reorder quantity" id="reorderQty" type="number" min={0} value={values.reorderQty} onChange={(v) => set("reorderQty", v)} error={fieldError("reorderQty")} />
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="text-base font-semibold">Selling prices</h2>
          <p className="text-sm text-muted-foreground">
            Customers on a tier with no price here are charged the {tiers.find((t) => t.isDefault)?.name ?? "default"} price.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {tiers.map((t, i) => (
            <TextField
              key={t.id}
              label={`${t.name} price (Rs)`}
              id={`price-${t.id}`}
              inputMode="decimal"
              className="tabular-nums"
              value={values.prices[t.id] ?? ""}
              onChange={(v) => set("prices", { ...values.prices, [t.id]: v })}
              error={fieldError(`prices.${i}.price`)}
              required={t.isDefault}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h2 className="text-base font-semibold">Fits these bikes</h2>
          <p className="text-sm text-muted-foreground">{values.fitmentIds.length} selected</p>
        </div>
        {vehicleModels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bike models yet. Add them under Categories, brands, models.</p>
        ) : (
          <>
            <Input
              placeholder="Filter bike models"
              aria-label="Filter bike models"
              value={fitmentFilter}
              onChange={(e) => setFitmentFilter(e.target.value)}
              className="sm:w-72"
            />
            <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3">
              {shownModels.map((m) => {
                const checked = values.fitmentIds.includes(m.id);
                return (
                  <label key={m.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) =>
                        set(
                          "fitmentIds",
                          c ? [...values.fitmentIds, m.id] : values.fitmentIds.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.label}
                  </label>
                );
              })}
            </div>
          </>
        )}
      </section>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={values.isActive} onCheckedChange={(c) => set("isActive", Boolean(c))} />
        Active (inactive parts can’t be sold)
      </label>

      {error && !error.field && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : partId ? "Save part" : "Create part"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TextField({
  label,
  id,
  value,
  onChange,
  error,
  className,
  ...rest
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "id">) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={className}
        {...rest}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
