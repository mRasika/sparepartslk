import { Download, FilePlus2, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelQuotationDialog } from "@/components/billing/cancel-quotation-dialog";
import { QuotationStatusBadge } from "@/components/billing/quotation-status-badge";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getQuotation, type QuotationDetail } from "@/server/services/quotations";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  let q: QuotationDetail;
  try {
    q = await getQuotation(id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const live = q.status === "open" || q.status === "expired";
  const vatOn = Number(q.vatRate) > 0;
  const who = q.customer.isWalkIn && q.quoteForName ? q.quoteForName : q.customer.name;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {q.number}
            <QuotationStatusBadge status={q.status} invoiceNumber={q.invoice?.number} />
          </span>
        }
        description={`${formatDate(q.quotationDate)}, ${who}`}
        actions={
          <>
            {live && (
              <Link href={`/quotations/${q.id}/edit`} className={buttonVariants({ variant: "outline" })}>
                <Pencil /> Edit
              </Link>
            )}
            {live && (
              <Link href={`/invoices/new?quotation=${q.id}`} className={buttonVariants()}>
                <FilePlus2 /> Convert to invoice
              </Link>
            )}
            <Link href={`/print/quotation/${q.id}`} className={buttonVariants({ variant: "outline" })}>
              <Printer /> Print A4
            </Link>
            <a
              href={`/api/quotations/${q.id}/pdf`}
              className={buttonVariants({ variant: "outline" })}
              target="_blank"
              rel="noreferrer"
            >
              <Download /> PDF
            </a>
            {live && <CancelQuotationDialog quotationId={q.id} number={q.number} />}
          </>
        }
      />

      {q.status === "converted" && q.invoice && (
        <p role="status" className="mb-6 rounded-lg border bg-card p-4 text-sm">
          Converted to{" "}
          <Link href={`/invoices/${q.invoice.id}`} className="font-medium hover:underline">
            {q.invoice.number}
          </Link>
          {q.convertedAt ? ` on ${formatDate(q.convertedAt)}` : ""}
        </p>
      )}

      {q.status === "cancelled" && (
        <p role="status" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          Cancelled{q.cancelledAt ? ` ${formatDateTime(q.cancelledAt)}` : ""}
          {q.cancelledByName ? ` by ${q.cancelledByName}` : ""}. Reason: {q.cancelReason}
        </p>
      )}

      <dl className="mb-6 grid grid-cols-2 gap-4 rounded-lg border bg-card p-5 sm:grid-cols-4">
        <Fact label="Customer">
          <Link href={`/customers/${q.customer.id}`} className="font-medium hover:underline">
            {q.customer.name}
          </Link>
          {q.customer.businessName && <div className="text-muted-foreground">{q.customer.businessName}</div>}
          {q.quoteForName && <div>For {q.quoteForName}</div>}
          {q.quoteForPhone && <div className="text-muted-foreground">{q.quoteForPhone}</div>}
        </Fact>
        <Fact label="Valid until">{formatDate(q.validUntil)}</Fact>
        <Fact label="Price tier">{q.tierName}</Fact>
        <Fact label="Quoted as">{q.paymentType === "cash" ? "Cash" : "Credit"}</Fact>
      </dl>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/parts/${i.partId}`} className="font-medium hover:underline">
                    {i.sku}
                  </Link>
                  <div className="text-xs text-muted-foreground">{i.description}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.unitPrice)}</TableCell>
                <TableCell className="text-right tabular-nums">{i.discount === "0.00" ? "–" : formatMoney(i.discount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="tabular-nums">
            <TotalRow label="Subtotal" value={q.subtotal} />
            {q.discountTotal !== "0.00" && <TotalRow label="Quotation discount" value={`-${q.discountTotal}`} />}
            {vatOn && <TotalRow label={`VAT ${Number(q.vatRate)}%`} value={q.vatAmount} />}
            <TableRow>
              <TableCell colSpan={4} className="text-right text-base font-semibold">
                Total
              </TableCell>
              <TableCell className="text-right text-base font-semibold">Rs {formatMoney(q.total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {q.note && (
        <section className="mt-6">
          <h2 className="mb-1 text-sm font-semibold">Note</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{q.note}</p>
        </section>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Created by {q.createdByName}, {formatDateTime(q.createdAt)}. Last updated by {q.updatedByName},{" "}
        {formatDateTime(q.updatedAt)}.
      </p>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell colSpan={4} className="text-right">
        {label}
      </TableCell>
      <TableCell className="text-right">{formatMoney(value)}</TableCell>
    </TableRow>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
