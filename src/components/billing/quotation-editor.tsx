"use client";

import { Download, Printer, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LineItemsGrid, type GridLine } from "@/components/forms/line-items-grid";
import type { PartFilterOptions } from "@/components/forms/part-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/action-result";
import { addDays } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { QUOTE_VALID_DAYS } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import {
  createQuotationAction,
  previewQuotationAction,
  updateQuotationAction,
} from "@/server/actions/quotations";
import type { Totals } from "@/server/services/pricing";
import type { QuotationEditorData, QuotationInput } from "@/server/services/quotations";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { DiscountInput } from "./discount-input";
import { discountOrUndefined, validDiscount, validQty } from "./line-input";
import { TotalsPanel, type DiscountState } from "./totals-panel";

type Line = GridLine & { qty: string; discount: DiscountState };
type Preview = Totals & { prices: Record<string, string>; stock: Record<string, number> };
type SaveMode = "save" | "a4" | "pdf";

const NO_DISCOUNT: DiscountState = { type: "percent", value: "" };

export function QuotationEditor({
  initialCustomer,
  quotation,
  partFilters,
  isAdmin,
  vatRate,
  staffCapPct,
  today,
}: {
  initialCustomer: PickedCustomer;
  /** Set when editing; its customer is `initialCustomer`. */
  quotation?: QuotationEditorData;
  partFilters: PartFilterOptions;
  isAdmin: boolean;
  vatRate: string;
  staffCapPct: string;
  /** Colombo business date from the server, for the default valid-until. */
  today: string;
}) {
  const router = useRouter();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [customer, setCustomer] = useState(initialCustomer);
  const [paymentType, setPaymentType] = useState<"cash" | "credit">(quotation?.paymentType ?? "cash");
  const [validUntil, setValidUntil] = useState(quotation?.validUntil ?? addDays(today, QUOTE_VALID_DAYS));
  const [quoteForName, setQuoteForName] = useState(quotation?.quoteForName ?? "");
  const [quoteForPhone, setQuoteForPhone] = useState(quotation?.quoteForPhone ?? "");
  const [note, setNote] = useState(quotation?.note ?? "");
  const [lines, setLines] = useState<Line[]>(
    () =>
      quotation?.lines.map((l, i) => ({
        key: `quotation-${i}`,
        part: l.part,
        qty: String(l.qty),
        discount: l.discount ?? NO_DISCOUNT,
      })) ?? [],
  );
  const [invoiceDiscount, setInvoiceDiscount] = useState<DiscountState>(quotation?.invoiceDiscount ?? NO_DISCOUNT);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();
  const previewId = useRef(0);
  /** A change the server hasn't seen yet (or can't: half-typed lines). */
  const dirty = useRef(false);

  const linesValid = lines.every((l) => validQty(l.qty) && validDiscount(l.discount)) && validDiscount(invoiceDiscount);

  const buildInput = useCallback(
    (): QuotationInput => ({
      customerId: customer.id,
      paymentType: customer.isWalkIn ? "cash" : paymentType,
      validUntil: validUntil || undefined,
      quoteForName: customer.isWalkIn ? quoteForName.trim() || undefined : undefined,
      quoteForPhone: customer.isWalkIn ? quoteForPhone.trim() || undefined : undefined,
      note: note.trim() || undefined,
      lines: lines.map((l) => ({ partId: l.part.id, qty: Number(l.qty), discount: discountOrUndefined(l.discount) })),
      invoiceDiscount: discountOrUndefined(invoiceDiscount),
    }),
    [customer, paymentType, validUntil, quoteForName, quoteForPhone, note, lines, invoiceDiscount],
  );

  // Live prices and totals from the server, so the screen always matches what will be saved.
  useEffect(() => {
    if (lines.length === 0) {
      setPreview(null);
      setError(null);
      dirty.current = false;
      return;
    }
    dirty.current = true;
    if (!linesValid) return;
    const id = ++previewId.current;
    const timer = setTimeout(async () => {
      const result = await previewQuotationAction(buildInput());
      if (id !== previewId.current) return;
      dirty.current = false;
      if (result.ok) {
        setPreview(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [lines, linesValid, buildInput]);

  // Closing the tab or reloading mid-change would lose the quotation being typed.
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
    const details = error?.details as { partId?: string } | undefined;
    if (details?.partId === line.part.id) return error?.message;
    return undefined;
  }

  /** Stock shortfall is only a heads-up: a quotation can offer parts that aren't on the shelf. */
  function stockNote(line: Line): string | undefined {
    const stock = preview?.stock[line.part.id] ?? line.part.qtyOnHand;
    return (qtyByPart.get(line.part.id) ?? 0) > stock ? `Only ${stock} in stock` : undefined;
  }

  function changeCustomer(c: PickedCustomer) {
    setCustomer(c);
    if (c.isWalkIn) setPaymentType("cash");
    pickerRef.current?.focus();
  }

  const canSave = lines.length > 0 && linesValid && validUntil >= today;

  function save(mode: SaveMode) {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      const input = buildInput();
      let saved: { id: string; number: string };
      if (quotation) {
        const result = await updateQuotationAction(quotation.id, input);
        if (!result.ok) {
          setError(result.error);
          toast.error(result.error.message);
          return;
        }
        saved = { id: quotation.id, number: quotation.number };
      } else {
        const result = await createQuotationAction(input);
        if (!result.ok) {
          setError(result.error);
          toast.error(result.error.message);
          return;
        }
        saved = result.data;
      }
      dirty.current = false;
      toast.success(`${saved.number} saved`);
      if (mode === "a4") {
        router.push(`/print/quotation/${saved.id}?autoprint=1`);
        return;
      }
      router.push(`/quotations/${saved.id}`);
      if (mode === "pdf") {
        const a = document.createElement("a");
        a.href = `/api/quotations/${saved.id}/pdf?download=1`;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
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
      className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <div className="grid min-w-0 content-start gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <CustomerPicker value={customer} onChange={changeCustomer} />
          <fieldset className="grid content-start gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Payment</legend>
            <div className="inline-flex rounded-lg border bg-card p-0.5" role="radiogroup" aria-label="Payment">
              {(["cash", "credit"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={paymentType === t}
                  disabled={t === "credit" && customer.isWalkIn}
                  onClick={() => setPaymentType(t)}
                  className={cn(
                    "h-8 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-40",
                    paymentType === t ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {t === "cash" ? "Cash" : "Credit"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <label htmlFor="valid-until" className="text-sm font-medium">
              Valid until
            </label>
            <Input
              id="valid-until"
              type="date"
              required
              min={today}
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
          {customer.isWalkIn && (
            <>
              <div className="grid gap-1.5">
                <label htmlFor="quote-for-name" className="text-sm font-medium">
                  Quote for (name)
                </label>
                <Input
                  id="quote-for-name"
                  maxLength={120}
                  autoComplete="off"
                  value={quoteForName}
                  onChange={(e) => setQuoteForName(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="quote-for-phone" className="text-sm font-medium">
                  Phone
                </label>
                <Input
                  id="quote-for-phone"
                  type="tel"
                  maxLength={40}
                  autoComplete="off"
                  value={quoteForPhone}
                  onChange={(e) => setQuoteForPhone(e.target.value)}
                />
              </div>
            </>
          )}
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
          newLine={(part) => ({ key: crypto.randomUUID(), part, qty: "1", discount: NO_DISCOUNT })}
          columns={[
            { field: "qty", label: "Qty", className: "text-right", inputMode: "numeric" },
            {
              field: "price" as keyof Line & string,
              label: "Price",
              className: "text-right",
              render: (l) => {
                const price = preview?.prices[l.part.id] ?? l.part.price;
                const short = stockNote(l);
                return (
                  <div>
                    <span className="tabular-nums">{price ? formatMoney(price) : "–"}</span>
                    {short && <div className="text-xs text-muted-foreground">{short}</div>}
                  </div>
                );
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
          <p className="text-xs text-muted-foreground">You can give up to {Number(staffCapPct)}% discount per line and on the quotation.</p>
        )}
      </div>

      <div className="grid min-w-0 content-start gap-4">
        <TotalsPanel
          subtotal={preview?.subtotal}
          invoiceDiscountAmount={preview?.invoiceDiscount}
          vatRate={vatRate}
          vatAmount={preview?.vatAmount}
          total={preview?.total}
          discount={invoiceDiscount}
          onDiscountChange={setInvoiceDiscount}
        />

        <div className="grid gap-1.5">
          <label htmlFor="quotation-note" className="text-sm font-medium">
            Note
          </label>
          <Textarea id="quotation-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {generalError && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {generalError.message}
          </p>
        )}

        <div className="grid gap-2">
          <Button type="submit" size="lg" disabled={pending || !canSave} className="h-11">
            <Save /> {pending ? "Saving…" : "Save quotation"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={pending || !canSave} onClick={() => save("a4")}>
              <Printer /> Save, print A4
            </Button>
            <Button type="button" variant="outline" disabled={pending || !canSave} onClick={() => save("pdf")}>
              <Download /> Save, download PDF
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">Ctrl + Enter saves</p>
        </div>
      </div>
    </form>
  );
}
