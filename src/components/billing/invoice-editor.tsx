"use client";

import { Printer, ReceiptText, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LineItemsGrid, type GridLine } from "@/components/forms/line-items-grid";
import type { PartFilterOptions } from "@/components/forms/part-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/action-result";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createInvoiceAction, discardInvoiceDraftAction, previewInvoiceAction } from "@/server/actions/invoices";
import type { EditorDraft } from "@/server/services/invoice-drafts";
import type { InvoiceInput } from "@/server/services/invoicing";
import type { Totals } from "@/server/services/pricing";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { DiscountInput } from "./discount-input";
import { TotalsPanel, type DiscountState } from "./totals-panel";

type Line = GridLine & { qty: string; discount: DiscountState };
type Preview = Totals & { prices: Record<string, string>; stock: Record<string, number> };
type SaveMode = "save" | "a4" | "thermal";

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;
const validQty = (q: string) => /^\d+$/.test(q.trim()) && Number(q) > 0;
const discountOrUndefined = (d: DiscountState) =>
  d.value.trim() === "" || Number(d.value) === 0 ? undefined : { type: d.type, value: d.value.trim() };
const validDiscount = (d: DiscountState) => d.value.trim() === "" || AMOUNT.test(d.value.trim());

const NO_DISCOUNT: DiscountState = { type: "percent", value: "" };

export function InvoiceEditor({
  initialCustomer,
  draft,
  partFilters,
  isAdmin,
  vatRate,
  staffCapPct,
}: {
  initialCustomer: PickedCustomer;
  /** Reopened draft; its customer is `initialCustomer`. */
  draft?: Omit<EditorDraft, "customer">;
  partFilters: PartFilterOptions;
  isAdmin: boolean;
  vatRate: string;
  staffCapPct: string;
}) {
  const router = useRouter();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [customer, setCustomer] = useState(initialCustomer);
  const [paymentType, setPaymentType] = useState<"cash" | "credit">(draft?.paymentType ?? "cash");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque">(draft?.cashPayment?.method ?? "cash");
  const [reference, setReference] = useState(draft?.cashPayment?.reference ?? "");
  const [lines, setLines] = useState<Line[]>(
    () =>
      draft?.lines.map((l, i) => ({
        key: `draft-${i}`,
        part: l.part,
        qty: String(l.qty),
        discount: l.discount ?? NO_DISCOUNT,
      })) ?? [],
  );
  const [invoiceDiscount, setInvoiceDiscount] = useState<DiscountState>(draft?.invoiceDiscount ?? NO_DISCOUNT);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [override, setOverride] = useState<{ mode: SaveMode; details: Record<string, string> } | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();
  const previewId = useRef(0);
  // The draft's id is made here so every auto-save upserts the same row; it's in the URL once saved.
  const draftId = useRef<string | null>(draft?.id ?? null);
  const draftSaved = useRef(Boolean(draft));
  /** A change the server hasn't seen yet (or can't: half-typed lines). */
  const dirty = useRef(false);
  const saving = useRef(false);

  const linesValid = lines.every((l) => validQty(l.qty) && validDiscount(l.discount)) && validDiscount(invoiceDiscount);

  const buildInput = useCallback(
    (overrideCreditLimit = false): InvoiceInput => ({
      customerId: customer.id,
      paymentType,
      lines: lines.map((l) => ({ partId: l.part.id, qty: Number(l.qty), discount: discountOrUndefined(l.discount) })),
      invoiceDiscount: discountOrUndefined(invoiceDiscount),
      overrideCreditLimit: overrideCreditLimit || undefined,
      cashPayment: paymentType === "cash" ? { method, reference: reference.trim() || undefined } : undefined,
      draftId: draftId.current ?? undefined,
    }),
    [customer.id, paymentType, lines, invoiceDiscount, method, reference],
  );

  // Live prices and totals from the server, so the screen always matches what will be saved.
  // The same request auto-saves the draft.
  useEffect(() => {
    if (lines.length === 0) {
      setPreview(null);
      setError(null);
      dirty.current = false;
      if (draftSaved.current && draftId.current) {
        void discardInvoiceDraftAction(draftId.current);
        window.history.replaceState(null, "", "/invoices/new");
      }
      draftSaved.current = false;
      draftId.current = null;
      setDraftSavedAt(null);
      return;
    }
    dirty.current = true;
    if (!linesValid) return;
    const id = ++previewId.current;
    draftId.current ??= crypto.randomUUID();
    const thisDraft = draftId.current;
    const timer = setTimeout(async () => {
      // A save already started would delete the draft; don't recreate it behind its back.
      if (saving.current) return;
      const result = await previewInvoiceAction(buildInput(), thisDraft);
      if (!draftSaved.current && draftId.current === thisDraft) {
        draftSaved.current = true;
        window.history.replaceState(null, "", `/invoices/new?draft=${thisDraft}`);
      }
      if (id !== previewId.current) return;
      dirty.current = false;
      setDraftSavedAt(new Date());
      if (result.ok) {
        setPreview(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [lines, linesValid, buildInput]);

  // Closing the tab or reloading mid-change would lose what the last auto-save didn't catch.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const qtyByPart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) if (validQty(l.qty)) m.set(l.part.id, (m.get(l.part.id) ?? 0) + Number(l.qty));
    return m;
  }, [lines]);

  function rowError(line: Line): string | undefined {
    if (!validQty(line.qty)) return "Enter a whole number of 1 or more";
    if (!validDiscount(line.discount)) return "Enter a discount like 5 or 12.50";
    const stock = preview?.stock[line.part.id] ?? line.part.qtyOnHand;
    if ((qtyByPart.get(line.part.id) ?? 0) > stock) return `Only ${stock} in stock`;
    const details = error?.details as { partId?: string } | undefined;
    if (details?.partId === line.part.id) return error?.message;
    return undefined;
  }

  function changeCustomer(c: PickedCustomer) {
    setCustomer(c);
    if (c.isWalkIn) setPaymentType("cash");
    pickerRef.current?.focus();
  }

  function save(mode: SaveMode, overrideCreditLimit = false) {
    if (lines.length === 0 || !linesValid) return;
    setError(null);
    saving.current = true;
    startTransition(async () => {
      const result = await createInvoiceAction(buildInput(overrideCreditLimit));
      saving.current = result.ok;
      if (!result.ok) {
        if (result.error.code === "CreditLimitExceeded" && isAdmin) {
          setOverride({ mode, details: result.error.details as Record<string, string> });
          return;
        }
        setError(result.error);
        toast.error(result.error.message);
        return;
      }
      setOverride(null);
      dirty.current = false;
      toast.success(`${result.data.number} saved`);
      const id = result.data.id;
      router.push(mode === "save" ? `/invoices/${id}` : `/print/invoice/${id}?format=${mode}&autoprint=1`);
    });
  }

  const generalError = error && !(error.details as { partId?: string } | undefined)?.partId ? error : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save("save");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save("save");
        }
      }}
      className="grid gap-6 xl:grid-cols-[1fr_22rem]"
    >
      <div className="grid content-start gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <CustomerPicker value={customer} onChange={changeCustomer} />
          <fieldset className="grid content-start gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Payment</legend>
            <div className="inline-flex rounded-lg border bg-card p-0.5" role="radiogroup">
              {(["cash", "credit"] as const).map((t) => {
                const disabled = t === "credit" && customer.isWalkIn;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={paymentType === t}
                    disabled={disabled}
                    onClick={() => setPaymentType(t)}
                    className={cn(
                      "h-8 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-40",
                      paymentType === t ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {t === "cash" ? "Cash" : "Credit"}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <LineItemsGrid<Line>
          lines={lines}
          onChange={setLines}
          pickerInputRef={pickerRef}
          pickerCustomerId={customer.id}
          pickerFilters={partFilters}
          pickerMeta={(p) =>
            p.price ? (
              <div className="font-medium">Rs {formatMoney(p.price)}</div>
            ) : (
              <div className="text-destructive">No price</div>
            )
          }
          newLine={(part) => ({ key: crypto.randomUUID(), part, qty: "1", discount: { type: "percent", value: "" } })}
          columns={[
            { field: "qty", label: "Qty", className: "text-right", inputMode: "numeric" },
            {
              field: "price" as keyof Line & string,
              label: "Price",
              className: "text-right",
              render: (l) => {
                const price = preview?.prices[l.part.id] ?? l.part.price;
                return <span className="tabular-nums">{price ? formatMoney(price) : "–"}</span>;
              },
            },
            {
              field: "discount",
              label: "Discount",
              className: "text-right",
              render: (l, update) => (
                <DiscountInput value={l.discount} onChange={(d) => update({ discount: d })} label={`Discount for ${l.part.sku}`} />
              ),
            },
          ]}
          lineTotal={(l) => {
            const i = lines.indexOf(l);
            const t = preview && linesValid ? preview.lines[i] : undefined;
            return t ? formatMoney(t.lineTotal) : "–";
          }}
          rowError={rowError}
          emptyText="Find a part above. Press Enter to add it, type the quantity, then Enter again for the next part."
        />
        {!isAdmin && (
          <p className="text-xs text-muted-foreground">You can give up to {Number(staffCapPct)}% discount per line and on the invoice.</p>
        )}
      </div>

      <div className="grid content-start gap-4">
        <TotalsPanel
          subtotal={preview?.subtotal}
          invoiceDiscountAmount={preview?.invoiceDiscount}
          vatRate={vatRate}
          vatAmount={preview?.vatAmount}
          total={preview?.total}
          discount={invoiceDiscount}
          onDiscountChange={setInvoiceDiscount}
        />

        {paymentType === "cash" && (
          <div className="grid gap-2 rounded-lg border bg-card p-4">
            <label htmlFor="method" className="text-sm font-medium">
              Paid by
            </label>
            <NativeSelect id="method" className="w-full" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <NativeSelectOption value="cash">Cash</NativeSelectOption>
              <NativeSelectOption value="bank">Bank transfer</NativeSelectOption>
              <NativeSelectOption value="cheque">Cheque</NativeSelectOption>
            </NativeSelect>
            {method !== "cash" && (
              <Input
                aria-label="Payment reference"
                placeholder={method === "cheque" ? "Cheque number" : "Transfer reference"}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            )}
          </div>
        )}

        {generalError && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {generalError.message}
          </p>
        )}

        <div className="grid gap-2">
          <Button type="submit" size="lg" disabled={pending || lines.length === 0 || !linesValid} className="h-11">
            <Save /> {pending ? "Saving…" : "Save invoice"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={pending || lines.length === 0 || !linesValid} onClick={() => save("a4")}>
              <Printer /> Save, print A4
            </Button>
            <Button type="button" variant="outline" disabled={pending || lines.length === 0 || !linesValid} onClick={() => save("thermal")}>
              <ReceiptText /> Save, receipt
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Ctrl + Enter saves
            {draftSavedAt && (
              <>
                {" · "}
                <span title="Find it under Unfinished invoices on New invoice">
                  Draft kept {draftSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <Dialog open={override !== null} onOpenChange={(o) => !o && setOverride(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Over the credit limit</DialogTitle>
            <DialogDescription>
              {customer.name} owes Rs {formatMoney(override?.details.balance)}. This invoice adds Rs{" "}
              {formatMoney(override?.details.invoiceTotal)}, over the limit of Rs {formatMoney(override?.details.limit)}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverride(null)}>
              Go back
            </Button>
            <Button disabled={pending} onClick={() => override && save(override.mode, true)}>
              Override limit and save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
