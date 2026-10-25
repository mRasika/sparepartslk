"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LineItemsGrid, type GridLine } from "@/components/forms/line-items-grid";
import type { PartFilterOptions } from "@/components/forms/part-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createAdjustmentAction } from "@/server/actions/stock";

type Reason = "damage" | "lost" | "count_correction" | "other";
type Line = GridLine & { qty: string };

const REASONS: { value: Reason; label: string; adminOnly?: boolean }[] = [
  { value: "damage", label: "Damaged" },
  { value: "lost", label: "Lost" },
  { value: "count_correction", label: "Count correction", adminOnly: true },
  { value: "other", label: "Other", adminOnly: true },
];

export function AdjustmentForm({ isAdmin, filters }: { isAdmin: boolean; filters: PartFilterOptions }) {
  const router = useRouter();
  const [reason, setReason] = useState<Reason>("damage");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Damage and loss only ever remove stock, so the user types how many to remove.
  const writeOff = reason === "damage" || reason === "lost";
  const qtyChange = (l: Line) => {
    const n = Number(l.qty);
    return writeOff ? -Math.abs(n) : n;
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createAdjustmentAction({
        reason,
        note,
        lines: lines.map((l) => ({ partId: l.part.id, qtyChange: qtyChange(l) })),
      });
      if (!result.ok) {
        setError(result.error.message);
        toast.error(result.error.message);
        return;
      }
      toast.success(`${result.data.number} saved. Stock updated.`);
      router.push("/stock/adjustments");
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-4xl gap-6">
      <div className="grid gap-1.5 sm:w-72">
        <Label htmlFor="reason">Reason</Label>
        <NativeSelect id="reason" className="w-full" value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
          {REASONS.filter((r) => isAdmin || !r.adminOnly).map((r) => (
            <NativeSelectOption key={r.value} value={r.value}>
              {r.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <LineItemsGrid<Line>
        lines={lines}
        onChange={setLines}
        pickerFilters={filters}
        newLine={(part) => ({ key: crypto.randomUUID(), part, qty: writeOff ? "1" : "" })}
        columns={[
          {
            field: "qty",
            label: writeOff ? "Qty to remove" : "Change (+ add, − remove)",
            className: "text-right",
            inputMode: "numeric",
          },
        ]}
        lineTotal={(l) => {
          const after = l.part.qtyOnHand + qtyChange(l);
          return Number.isInteger(qtyChange(l)) ? (
            <span className={after < 0 ? "font-medium text-destructive" : ""}>
              {l.part.qtyOnHand} → {after}
            </span>
          ) : (
            "–"
          );
        }}
        rowError={(l) => (l.part.qtyOnHand + qtyChange(l) < 0 ? `Only ${l.part.qtyOnHand} in stock` : undefined)}
      />

      <div className="grid gap-1.5">
        <Label htmlFor="note">Note</Label>
        <Textarea
          id="note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened? e.g. cracked in delivery"
          className="max-w-xl"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending || lines.length === 0}>
          {pending ? "Saving…" : "Save adjustment"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
