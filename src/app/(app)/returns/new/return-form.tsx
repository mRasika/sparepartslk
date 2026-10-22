"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { D, fmt, round2, sum } from "@/lib/money";
import { createReturnAction } from "@/server/actions/returns";
import type { ReturnableItem } from "@/server/services/returns";

type LineState = { qty: string; restock: boolean };

export function ReturnForm({
  invoiceId,
  items,
  isWalkIn,
  invoiceSubtotal,
  invoiceTotal,
}: {
  invoiceId: string;
  items: ReturnableItem[];
  isWalkIn: boolean;
  invoiceSubtotal: string;
  invoiceTotal: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(items.map((i) => [i.invoiceItemId, { qty: "", restock: true }])),
  );
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState<"" | "cash" | "bank">(isWalkIn ? "cash" : "");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = items
    .map((i) => ({ item: i, state: lines[i.invoiceItemId] }))
    .filter(({ state }) => /^\d+$/.test(state.qty.trim()) && Number(state.qty) > 0);
  const overLimit = chosen.find(({ item, state }) => Number(state.qty) > item.returnable);
  // Same arithmetic as the server: share of the line total, then the invoice's total/subtotal ratio.
  const subtotal = sum(
    chosen.map(({ item, state }) => round2(D(state.qty).times(item.lineTotal).div(item.sold))),
  );
  const total = D(invoiceSubtotal).isZero() ? D(0) : round2(subtotal.times(invoiceTotal).div(invoiceSubtotal));

  const set = (id: string, patch: Partial<LineState>) => setLines((l) => ({ ...l, [id]: { ...l[id], ...patch } }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createReturnAction({
        invoiceId,
        reason,
        lines: chosen.map(({ item, state }) => ({
          invoiceItemId: item.invoiceItemId,
          qty: Number(state.qty),
          restock: state.restock,
        })),
        refund: refund ? { method: refund, reference } : undefined,
      });
      if (!result.ok) {
        setError(result.error.message);
        toast.error(result.error.message);
        return;
      }
      toast.success(`${result.data.number} saved`);
      router.push(`/returns/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-4xl gap-6">
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Can return</TableHead>
              <TableHead className="text-right">Return qty</TableHead>
              <TableHead className="text-center">Back to stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => {
              const state = lines[i.invoiceItemId];
              const tooMany = Number(state.qty) > i.returnable;
              return (
                <TableRow key={i.invoiceItemId} className={i.returnable === 0 ? "text-muted-foreground" : ""}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{i.sku}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.description}, Rs {formatMoney(i.unitPrice)} each after discount
                    </div>
                    {tooMany && <div className="text-xs text-destructive">Only {i.returnable} can be returned</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.sold}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.returnable}</TableCell>
                  <TableCell className="text-right">
                    <input
                      aria-label={`Return qty for ${i.sku}`}
                      inputMode="numeric"
                      disabled={i.returnable === 0}
                      value={state.qty}
                      onChange={(e) => set(i.invoiceItemId, { qty: e.target.value })}
                      aria-invalid={tooMany || undefined}
                      className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 aria-invalid:border-destructive"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      aria-label={`Put ${i.sku} back in stock`}
                      checked={state.restock}
                      disabled={i.returnable === 0}
                      onCheckedChange={(c) => set(i.invoiceItemId, { restock: Boolean(c) })}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">Untick “Back to stock” for damaged items. They are credited but not restocked.</p>

      <div className="grid gap-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Textarea id="reason" rows={2} required value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-xl" />
      </div>

      <div className="grid max-w-xl gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Credit for this return</span>
          <span className="text-xl font-semibold tabular-nums text-primary">Rs {formatMoney(fmt(total))}</span>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="refund">Money back</Label>
          <NativeSelect id="refund" className="w-full" value={refund} onChange={(e) => setRefund(e.target.value as typeof refund)}>
            {!isWalkIn && <NativeSelectOption value="">Keep as credit on the account</NativeSelectOption>}
            <NativeSelectOption value="cash">Refund in cash now</NativeSelectOption>
            <NativeSelectOption value="bank">Refund by bank transfer</NativeSelectOption>
          </NativeSelect>
          {isWalkIn && <p className="text-xs text-muted-foreground">Walk-in customers are always refunded.</p>}
        </div>
        {refund === "bank" && (
          <Input aria-label="Transfer reference" placeholder="Transfer reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending || chosen.length === 0 || Boolean(overLimit) || !reason.trim()}>
          {pending ? "Saving…" : "Save return"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
