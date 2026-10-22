"use client";

import { formatMoney } from "@/lib/format";
import { DiscountInput } from "./discount-input";

export type DiscountState = { type: "percent" | "amount"; value: string };

/** Subtotal → invoice discount → VAT → total, with the invoice discount editable. */
export function TotalsPanel({
  subtotal,
  invoiceDiscountAmount,
  vatRate,
  vatAmount,
  total,
  discount,
  onDiscountChange,
}: {
  subtotal?: string;
  invoiceDiscountAmount?: string;
  vatRate: string;
  vatAmount?: string;
  total?: string;
  discount: DiscountState;
  onDiscountChange: (d: DiscountState) => void;
}) {
  const vatOn = Number(vatRate) > 0;
  return (
    <dl className="grid gap-2 rounded-lg border bg-card p-4 text-sm tabular-nums">
      <Row label="Subtotal" value={subtotal} />
      <div className="flex items-center justify-between gap-3">
        <dt className="flex items-center gap-2">
          Invoice discount
          <DiscountInput value={discount} onChange={onDiscountChange} label="Invoice discount" />
        </dt>
        <dd>{invoiceDiscountAmount && invoiceDiscountAmount !== "0.00" ? `−${formatMoney(invoiceDiscountAmount)}` : "–"}</dd>
      </div>
      {vatOn && <Row label={`VAT ${Number(vatRate)}%`} value={vatAmount} />}
      <div className="mt-1 flex items-baseline justify-between border-t pt-3">
        <dt className="text-base font-semibold">Total</dt>
        <dd className="text-2xl font-semibold text-primary">Rs {total ? formatMoney(total) : "0.00"}</dd>
      </div>
    </dl>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd>{value ? formatMoney(value) : "–"}</dd>
    </div>
  );
}
