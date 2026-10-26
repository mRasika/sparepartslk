/* eslint-disable @next/next/no-img-element -- the logo is a user-uploaded URL printed as-is */
import { formatDate, formatMoney } from "@/lib/format";
import type { InvoicePrintData } from "@/server/services/print";

const A4_CSS = `
@page { size: A4; margin: 12mm; }
.inv-a4 { font-size: 10.5pt; color: #111; background: #fff; max-width: 186mm; margin: 0 auto; position: relative; }
.inv-a4 table { width: 100%; border-collapse: collapse; }
.inv-a4 th { text-align: left; font-weight: 600; border-bottom: 1.5px solid #111; padding: 6px 4px; font-size: 9pt; }
.inv-a4 td { border-bottom: 1px solid #ddd; padding: 6px 4px; vertical-align: top; }
.inv-a4 .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.inv-a4 .watermark { position: absolute; inset: 30% 0 auto 0; text-align: center; font-size: 72pt; font-weight: 700;
  color: rgba(200, 30, 30, 0.18); transform: rotate(-24deg); pointer-events: none; letter-spacing: 6px; }
@media print { .inv-a4 { max-width: none; } }
`;

export function InvoiceA4({ data }: { data: InvoicePrintData }) {
  const quote = data.kind === "quotation";
  const vatOn = Number(data.vatRate) > 0;
  const hasLineDiscount = data.lines.some((l) => l.discount !== "0.00");

  return (
    <article className="inv-a4 p-8 print:p-0">
      <style>{A4_CSS}</style>
      {data.status === "cancelled" && <div className="watermark">CANCELLED</div>}

      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
        <div className="flex gap-4">
          {data.business.logoUrl && <img src={data.business.logoUrl} alt="" className="h-16 w-auto object-contain" />}
          <div>
            <h1 className="text-xl font-bold">{data.business.name || "Business name not set"}</h1>
            {data.business.address && <p className="whitespace-pre-line">{data.business.address}</p>}
            <p>{[data.business.phone, data.business.email].filter(Boolean).join("  |  ")}</p>
            {data.business.tin && <p>TIN: {data.business.tin}</p>}
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold tracking-wide">{data.title}</h2>
          <table className="mt-2 ml-auto w-auto text-sm">
            <tbody>
              <MetaRow label="No" value={data.number} />
              <MetaRow label="Date" value={formatDate(data.date)} />
              {quote && data.validUntil && <MetaRow label="Valid until" value={formatDate(data.validUntil)} />}
              {!quote && data.paymentType === "credit" && <MetaRow label="Due" value={formatDate(data.dueDate)} />}
              {!quote && <MetaRow label="Payment" value={data.paymentType === "cash" ? "Cash" : "Credit"} />}
            </tbody>
          </table>
        </div>
      </header>

      <section className="py-4">
        <p className="text-xs font-semibold text-gray-600">{quote ? "Quotation for" : "Bill to"}</p>
        <p className="font-semibold">{data.customer.name}</p>
        {data.customer.businessName && <p>{data.customer.businessName}</p>}
        {data.customer.address && <p className="whitespace-pre-line">{data.customer.address}</p>}
        {data.customer.phone && <p>{data.customer.phone}</p>}
        {(vatOn || data.customer.tin) && <p>TIN: {data.customer.tin || "Not provided"}</p>}
      </section>

      <table>
        <thead>
          <tr>
            <th style={{ width: "7mm" }}>#</th>
            <th>SKU</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Unit price</th>
            {hasLineDiscount && <th className="num">Discount</th>}
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="whitespace-nowrap">{l.sku}</td>
              <td>{l.description}</td>
              <td className="num">{l.qty}</td>
              <td className="num">{formatMoney(l.unitPrice)}</td>
              {hasLineDiscount && <td className="num">{l.discount === "0.00" ? "" : formatMoney(l.discount)}</td>}
              <td className="num">{formatMoney(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-between gap-8">
        {quote ? <div /> : <p className="max-w-[55%] self-end text-sm italic">{data.amountInWords}</p>}
        <table className="w-auto min-w-[70mm]">
          <tbody>
            <TotalRow label="Subtotal" value={data.subtotal} />
            {data.invoiceDiscount !== "0.00" && <TotalRow label="Discount" value={`-${data.invoiceDiscount}`} />}
            {vatOn && <TotalRow label={`VAT ${Number(data.vatRate)}%`} value={data.vatAmount} />}
            <tr>
              <td className="pt-2 text-base font-bold" style={{ borderBottom: "none" }}>
                Total (Rs)
              </td>
              <td className="num pt-2 text-base font-bold" style={{ borderBottom: "none" }}>
                {formatMoney(data.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {quote && (
        <div className="mt-6 text-sm">
          {data.validUntil && <p>Prices valid until {formatDate(data.validUntil)}. Subject to stock availability.</p>}
          {data.note && <p className="mt-1 whitespace-pre-line">{data.note}</p>}
        </div>
      )}

      <footer className="mt-16 grid grid-cols-2 gap-16 text-sm">
        <div>
          <p>Prepared by: {data.preparedBy}</p>
        </div>
        {!quote && (
          <div className="text-center">
            <div className="border-t border-black pt-1">Received by (signature and date)</div>
          </div>
        )}
      </footer>
    </article>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="pr-3 text-gray-600" style={{ border: "none", padding: "1px 12px 1px 0" }}>
        {label}
      </td>
      <td className="font-medium" style={{ border: "none", padding: "1px 0", textAlign: "right" }}>
        {value}
      </td>
    </tr>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{formatMoney(value)}</td>
    </tr>
  );
}
