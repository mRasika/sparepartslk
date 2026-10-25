"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { ROUND_TO_OPTIONS } from "@/lib/tier-rule";
import { cn } from "@/lib/utils";
import { applyBulkPriceChangeAction, previewBulkPriceChangeAction } from "@/server/actions/tiers";
import type { BulkChangeInput, BulkPreview } from "@/server/services/tiers";

type Option = { id: string; name: string };

export function BulkPriceForm({
  tiers,
  categories,
  brands,
}: {
  tiers: (Option & { isDefault: boolean })[];
  categories: Option[];
  brands: Option[];
}) {
  const router = useRouter();
  const [tierId, setTierId] = useState(tiers.find((t) => t.isDefault)?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [changePct, setChangePct] = useState("");
  const [roundTo, setRoundTo] = useState("10");
  const [preview, setPreview] = useState<{ input: BulkChangeInput; result: BulkPreview } | null>(null);
  const [pending, startTransition] = useTransition();
  const tier = tiers.find((t) => t.id === tierId);

  const input: BulkChangeInput = { tierId, categoryId, brandId, changePct: changePct.trim(), roundTo: Number(roundTo) };
  const previewCurrent = preview && JSON.stringify(preview.input) === JSON.stringify(input);

  function runPreview(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await previewBulkPriceChangeAction(input);
      if (!result.ok) {
        toast.error(result.error.message);
        setPreview(null);
        return;
      }
      setPreview({ input, result: result.data });
    });
  }

  function apply() {
    if (!preview) return;
    startTransition(async () => {
      const result = await applyBulkPriceChangeAction(preview.input);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${result.data.updated} prices updated`);
      setPreview(null);
      setChangePct("");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={runPreview} className="grid max-w-4xl gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-tier">Tier</Label>
          <NativeSelect id="bulk-tier" className="w-full" value={tierId} onChange={(e) => setTierId(e.target.value)}>
            {tiers.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-category">Category</Label>
          <NativeSelect id="bulk-category" className="w-full" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <NativeSelectOption value="">All categories</NativeSelectOption>
            {categories.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-brand">Brand</Label>
          <NativeSelect id="bulk-brand" className="w-full" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <NativeSelectOption value="">All brands</NativeSelectOption>
            {brands.map((b) => (
              <NativeSelectOption key={b.id} value={b.id}>
                {b.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-pct">Change (%)</Label>
          <Input
            id="bulk-pct"
            inputMode="decimal"
            placeholder="7 to raise, -5 to lower"
            value={changePct}
            onChange={(e) => setChangePct(e.target.value)}
            className="tabular-nums"
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-round">Round new prices</Label>
          <NativeSelect id="bulk-round" className="w-full" value={roundTo} onChange={(e) => setRoundTo(e.target.value)}>
            {ROUND_TO_OPTIONS.map((n) => (
              <NativeSelectOption key={n} value={String(n)}>
                {n === 0 ? "No rounding" : `Nearest Rs ${n}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={pending || !changePct.trim()} className="w-full">
            {pending && !preview ? "Working…" : "Preview"}
          </Button>
        </div>
        {tier && !tier.isDefault && (
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Only parts with a {tier.name} price typed in change. Parts that follow the {tier.name} rule move with the base
            price; to change them all, change the rule under Settings, Price tiers.
          </p>
        )}
      </form>

      {preview && (
        <section className="grid gap-3" aria-label="Preview">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              <span className="font-semibold">{preview.result.count}</span> {preview.result.count === 1 ? "price" : "prices"}{" "}
              will change.
              {preview.result.belowCostCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="size-3.5" aria-hidden /> {preview.result.belowCostCount} below average cost
                </span>
              )}
            </p>
            <Button className="ml-auto" disabled={pending || !previewCurrent || preview.result.count === 0} onClick={apply}>
              {pending ? "Applying…" : `Apply to ${preview.result.count} ${preview.result.count === 1 ? "price" : "prices"}`}
            </Button>
          </div>
          {!previewCurrent && <p className="text-xs text-muted-foreground">You changed the form. Preview again before applying.</p>}
          {preview.result.count > 0 && (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part</TableHead>
                    <TableHead className="text-right">Now</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Avg cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.result.rows.map((r) => (
                    <TableRow key={r.partId}>
                      <TableCell>
                        <span className="font-medium">{r.sku}</span> {r.name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(r.oldPrice)}</TableCell>
                      <TableCell className={cn("text-right font-medium tabular-nums", r.belowCost && "text-destructive")}>
                        {formatMoney(r.newPrice)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                        {formatMoney(r.avgCost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.result.count > preview.result.rows.length && (
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                  Showing the first {preview.result.rows.length} of {preview.result.count}.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
