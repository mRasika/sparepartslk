import { formatDate, formatMoney } from "@/lib/format";
import type { InvoicePrintData } from "@/server/services/print";

const THERMAL_CSS = `
@page { size: 80mm auto; margin: 3mm; }
.inv-thermal { width: 72mm; margin: 0 auto; font-family: ui-monospace, "Courier New", monospace; font-size: 11px;
  line-height: 1.35; color: #000; background: #fff; }
.inv-thermal .c { text-align: center; }
.inv-thermal .row { display: flex; justify-content: space-between; gap: 6px; }
.inv-thermal .rule { border-top: 1px dashed #000; margin: 5px 0; }
.inv-thermal .big { font-size: 14px; font-weight: 700; }
`;

/** 80mm receipt: the A4 content, condensed. TINs show when VAT is on. */
export function InvoiceThermal({ data }: { data: InvoicePrintData }) {
  const vatOn = Number(data.vatRate) > 0;
  return (
    <article className="inv-thermal py-4 print:py-0">
      <style>{THERMAL_CSS}</style>
      <div className="c">
        <div className="big">{data.business.name}</div>
        {data.business.address && <div>{data.business.address}</div>}
        {data.business.phone && <div>{data.business.phone}</div>}
        {vatOn && data.business.tin && <div>TIN {data.business.tin}</div>}
        <div className="rule" />
        <div className="big">{data.status === "cancelled" ? `CANCELLED ${data.title}` : data.title}</div>
      </div>
      <div className="row">
        <span>{data.number}</span>
        <span>{formatDate(data.date)}</span>
      </div>
      <div>Customer: {data.customer.name}</div>
      {vatOn && data.customer.tin && <div>Cust TIN: {data.customer.tin}</div>}
      <div>{data.paymentType === "cash" ? "Cash sale" : `Credit, due ${formatDate(data.dueDate)}`}</div>
      <div className="rule" />
      {data.lines.map((l, i) => (
        <div key={i} style={{ marginBottom: 3 }}>
          <div>{l.description}</div>
          <div className="row">
            <span>
              {l.qty} x {formatMoney(l.unitPrice)}
              {l.discount !== "0.00" && ` -${formatMoney(l.discount)}`}
            </span>
            <span>= {formatMoney(l.lineTotal)}</span>
          </div>
        </div>
      ))}
      <div className="rule" />
      <div className="row">
        <span>Subtotal</span>
        <span>{formatMoney(data.subtotal)}</span>
      </div>
      {data.invoiceDiscount !== "0.00" && (
        <div className="row">
          <span>Discount</span>
          <span>-{formatMoney(data.invoiceDiscount)}</span>
        </div>
      )}
      {vatOn && (
        <div className="row">
          <span>VAT {Number(data.vatRate)}%</span>
          <span>{formatMoney(data.vatAmount)}</span>
        </div>
      )}
      <div className="row big">
        <span>TOTAL Rs</span>
        <span>{formatMoney(data.total)}</span>
      </div>
      <div className="rule" />
      <div>Served by {data.preparedBy}</div>
      <div className="c" style={{ marginTop: 6 }}>
        Thank you. Goods once sold are returnable only with this receipt.
      </div>
    </article>
  );
}
