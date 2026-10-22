"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LineItemsGrid, type GridLine } from "@/components/forms/line-items-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { TableCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/action-result";
import { formatMoney } from "@/lib/format";
import { D, fmt, round2, sum } from "@/lib/money";
import { createGrnAction } from "@/server/actions/grn";

type Line = GridLine & { qty: string; unitCost: string };

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

function lineAmount(l: Line) {
  const qty = Number(l.qty);
  if (!Number.isInteger(qty) || qty <= 0 || !MONEY.test(l.unitCost.trim())) return null;
  return round2(D(qty).times(l.unitCost.trim()));
}

export function GrnForm({
  suppliers,
  today,
}: {
  suppliers: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [receivedDate, setReceivedDate] = useState(today);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  const amounts = lines.map(lineAmount);
  const total = fmt(sum(amounts.filter((a) => a !== null)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createGrnAction({
        supplierId,
        supplierInvoiceNo,
        receivedDate,
        note,
        lines: lines.map((l) => ({ partId: l.part.id, qty: l.qty, unitCost: l.unitCost })),
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error.message);
        return;
      }
      toast.success(`${result.data.number} saved. Stock updated.`);
      router.push(`/grn/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-5xl gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5 lg:col-span-2">
          <Label htmlFor="supplierId">Supplier</Label>
          <NativeSelect
            id="supplierId"
            className="w-full"
            required
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            aria-invalid={error?.field === "supplierId" || undefined}
          >
            <NativeSelectOption value="">Choose a supplier</NativeSelectOption>
            {suppliers.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="supplierInvoiceNo">Supplier invoice no</Label>
          <Input id="supplierInvoiceNo" value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="receivedDate">Received on</Label>
          <Input id="receivedDate" type="date" required value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </div>
      </div>

      <LineItemsGrid<Line>
        lines={lines}
        onChange={setLines}
        newLine={(part) => ({ key: crypto.randomUUID(), part, qty: "1", unitCost: "" })}
        columns={[
          { field: "qty", label: "Qty", className: "text-right", inputMode: "numeric" },
          { field: "unitCost", label: "Unit cost (Rs)", className: "text-right", inputMode: "decimal" },
        ]}
        lineTotal={(l) => {
          const a = lineAmount(l);
          return a ? formatMoney(fmt(a)) : <span className="text-muted-foreground">–</span>;
        }}
        footer={
          <TableRow>
            <TableCell colSpan={3} className="text-right font-medium">
              Total
            </TableCell>
            <TableCell className="text-right text-base font-semibold tabular-nums">Rs {formatMoney(total)}</TableCell>
            <TableCell />
          </TableRow>
        }
      />

      <div className="grid gap-1.5">
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="max-w-xl" />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending || lines.length === 0}>
          {pending ? "Saving…" : "Save GRN and add stock"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
