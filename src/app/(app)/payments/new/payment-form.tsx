"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CustomerPicker, type PickedCustomer } from "@/components/billing/customer-picker";
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
import type { ActionError } from "@/lib/action-result";
import { autoAllocate } from "@/lib/allocation";
import { formatDate, formatMoney } from "@/lib/format";
import { D, fmt, sum } from "@/lib/money";
import { openInvoicesAction, receivePaymentAction } from "@/server/actions/payments";
import type { OutstandingRow } from "@/server/services/customers";

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

export function PaymentForm({
  initialCustomer,
  isAdmin,
  today,
}: {
  initialCustomer: PickedCustomer | null;
  isAdmin: boolean;
  today: string;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState(initialCustomer);
  const [open, setOpen] = useState<OutstandingRow[]>([]);
  const [balance, setBalance] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque">("cash");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [manual, setManual] = useState(false);
  const [manualAmounts, setManualAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!customer) return;
    let cancelled = false;
    openInvoicesAction(customer.id).then((r) => {
      if (cancelled || !r.ok) return;
      setOpen(r.data.invoices);
      setBalance(r.data.balance);
      setManualAmounts({});
    });
    return () => {
      cancelled = true;
    };
  }, [customer]);

  const amountValid = AMOUNT.test(amount.trim()) && D(amount.trim()).greaterThan(0);
  const auto = autoAllocate(amount, open);
  const allocationFor = (invoiceId: string) =>
    manual ? (manualAmounts[invoiceId] ?? "") : (auto.allocations.find((a) => a.invoiceId === invoiceId)?.amount ?? "");
  const manualTotal = sum(Object.values(manualAmounts).filter((v) => AMOUNT.test(v.trim())).map((v) => D(v.trim())));
  const unapplied = manual ? (amountValid ? fmt(D(amount.trim()).minus(manualTotal)) : "0.00") : auto.unapplied;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return;
    setError(null);
    startTransition(async () => {
      const result = await receivePaymentAction({
        customerId: customer.id,
        amount,
        method,
        reference,
        paymentDate,
        allocations: manual
          ? Object.entries(manualAmounts)
              .filter(([, v]) => AMOUNT.test(v.trim()) && D(v.trim()).greaterThan(0))
              .map(([invoiceId, v]) => ({ invoiceId, amount: v.trim() }))
          : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error.message);
        return;
      }
      toast.success(
        `${result.data.number} saved` +
          (result.data.unapplied !== "0.00" ? `. Rs ${formatMoney(result.data.unapplied)} kept as credit.` : ""),
      );
      router.push(`/customers/${customer.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-4xl gap-6">
      <div className="max-w-xl">
        <CustomerPicker value={customer} onChange={setCustomer} />
        {customer && balance !== null && (
          <p className="mt-2 text-sm">
            {D(balance).greaterThan(0) ? (
              <>
                Owes <span className="font-semibold tabular-nums">Rs {formatMoney(balance)}</span>
              </>
            ) : D(balance).lessThan(0) ? (
              <>
                Has <span className="font-semibold tabular-nums">Rs {formatMoney(balance.replace("-", ""))}</span> credit
              </>
            ) : (
              "Owes nothing"
            )}
          </p>
        )}
      </div>

      {customer && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="amount">Amount (Rs)</Label>
              <Input
                id="amount"
                inputMode="decimal"
                required
                autoFocus
                className="tabular-nums"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={error?.field === "amount" || undefined}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="method">Method</Label>
              <NativeSelect id="method" className="w-full" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <NativeSelectOption value="cash">Cash</NativeSelectOption>
                <NativeSelectOption value="bank">Bank transfer</NativeSelectOption>
                <NativeSelectOption value="cheque">Cheque</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reference">{method === "cheque" ? "Cheque no" : "Reference"}</Label>
              <Input
                id="reference"
                value={reference}
                required={method !== "cash"}
                onChange={(e) => setReference(e.target.value)}
                aria-invalid={error?.field === "reference" || undefined}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="paymentDate">Date</Label>
              <Input id="paymentDate" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </div>
          </div>

          <section className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Applied to</h2>
                <p className="text-sm text-muted-foreground">
                  {manual ? "Enter how much goes to each invoice." : "Oldest due invoices are paid first."}
                </p>
              </div>
              {isAdmin && open.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={manual} onCheckedChange={(c) => setManual(Boolean(c))} />
                  Choose invoices myself
                </label>
              )}
            </div>
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Owed</TableHead>
                    <TableHead className="text-right">This payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No unpaid invoices. The whole amount will be kept as credit.
                      </TableCell>
                    </TableRow>
                  )}
                  {open.map((inv) => (
                    <TableRow key={inv.invoiceId}>
                      <TableCell className="font-medium">{inv.number}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(inv.dueDate)}
                        {inv.daysOverdue > 0 && <span className="ml-2 text-xs text-destructive">{inv.daysOverdue}d overdue</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(inv.outstanding)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {manual ? (
                          <input
                            aria-label={`Amount for ${inv.number}`}
                            inputMode="decimal"
                            value={manualAmounts[inv.invoiceId] ?? ""}
                            onChange={(e) => setManualAmounts((m) => ({ ...m, [inv.invoiceId]: e.target.value }))}
                            className="h-8 w-28 rounded-md border border-input bg-transparent px-2 text-right text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          />
                        ) : allocationFor(inv.invoiceId) ? (
                          formatMoney(allocationFor(inv.invoiceId))
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {amountValid && unapplied !== "0.00" && (
              <p className={D(unapplied).lessThan(0) ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {D(unapplied).lessThan(0)
                  ? `Allocations are Rs ${formatMoney(unapplied.replace("-", ""))} more than the payment.`
                  : `Rs ${formatMoney(unapplied)} will be kept as credit on the account.`}
              </p>
            )}
          </section>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="lg" disabled={pending || !amountValid}>
              {pending ? "Saving…" : "Save payment"}
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
