import { Download, Printer, ReceiptText, Wallet } from "lucide-react";
import { CancelInvoiceDialog } from "@/components/billing/cancel-invoice-dialog";
import { D } from "@/lib/money";
import { db } from "@/server/db/client";
import { invoiceOutstanding } from "@/server/services/customers";
import { paymentsForInvoice } from "@/server/services/payments";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { getInvoice, type InvoiceDetail } from "@/server/services/invoicing";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let inv: InvoiceDetail;
  try {
    inv = await getInvoice(user, id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const cancelled = inv.status === "cancelled";
  const vatOn = Number(inv.vatRate) > 0;
  const [outstandingMap, paid] = await Promise.all([invoiceOutstanding(db, [inv.id]), paymentsForInvoice(inv.id)]);
  const outstanding = outstandingMap.get(inv.id)?.outstanding ?? inv.total;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {inv.number}
            {cancelled ? (
              <Badge variant="destructive">Cancelled</Badge>
            ) : (
              <Badge variant="secondary">{inv.paymentType === "cash" ? "Cash sale" : "Credit"}</Badge>
            )}
          </span>
        }
        description={`${formatDate(inv.invoiceDate)}, ${inv.customer.name}`}
        actions={
          <>
            <Link href={`/print/invoice/${inv.id}?format=a4`} className={buttonVariants({ variant: "outline" })}>
              <Printer /> Print A4
            </Link>
            <Link href={`/print/invoice/${inv.id}?format=thermal`} className={buttonVariants({ variant: "outline" })}>
              <ReceiptText /> Receipt
            </Link>
            <a href={`/api/invoices/${inv.id}/pdf`} className={buttonVariants({ variant: "outline" })} target="_blank" rel="noreferrer">
              <Download /> PDF
            </a>
            {!cancelled && user.role === "admin" && <CancelInvoiceDialog invoiceId={inv.id} number={inv.number} />}
          </>
        }
      />

      {!cancelled && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <p className="text-sm">
            {D(outstanding).greaterThan(0) ? (
              <>
                Still owed <span className="text-lg font-semibold tabular-nums">Rs {formatMoney(outstanding)}</span>
                {inv.paymentType === "credit" && <span className="ml-2 text-muted-foreground">due {formatDate(inv.dueDate)}</span>}
              </>
            ) : (
              <span className="font-medium">Paid in full</span>
            )}
          </p>
          {D(outstanding).greaterThan(0) && !inv.customer.isWalkIn && (
            <Link href={`/payments/new?customerId=${inv.customer.id}`} className={buttonVariants({ variant: "secondary" })}>
              <Wallet /> Receive payment
            </Link>
          )}
        </div>
      )}

      {cancelled && (
        <p role="status" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          Cancelled {inv.cancelledAt ? formatDateTime(inv.cancelledAt) : ""}. Reason: {inv.cancelReason}
        </p>
      )}

      <dl className="mb-6 grid grid-cols-2 gap-4 rounded-lg border bg-card p-5 sm:grid-cols-4">
        <Fact label="Customer">
          <Link href={`/customers/${inv.customer.id}`} className="font-medium hover:underline">
            {inv.customer.name}
          </Link>
          {inv.customer.businessName && <div className="text-muted-foreground">{inv.customer.businessName}</div>}
        </Fact>
        <Fact label="Price tier">{inv.tierName}</Fact>
        <Fact label={inv.paymentType === "credit" ? "Due" : "Paid"}>
          {inv.paymentType === "credit" ? formatDate(inv.dueDate) : "On the spot"}
        </Fact>
        <Fact label="Prepared by">{inv.createdByName}</Fact>
      </dl>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              {user.role === "admin" && <TableHead className="hidden text-right md:table-cell">Cost</TableHead>}
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inv.items.map((i) => (
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
                {user.role === "admin" && (
                  <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                    {formatMoney(i.unitCost)}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">{formatMoney(i.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="tabular-nums">
            <TotalRow cols={user.role === "admin" ? 5 : 4} label="Subtotal" value={inv.subtotal} />
            {inv.discountTotal !== "0.00" && (
              <TotalRow cols={user.role === "admin" ? 5 : 4} label="Invoice discount" value={`-${inv.discountTotal}`} />
            )}
            {vatOn && <TotalRow cols={user.role === "admin" ? 5 : 4} label={`VAT ${Number(inv.vatRate)}%`} value={inv.vatAmount} />}
            <TableRow>
              <TableCell colSpan={user.role === "admin" ? 5 : 4} className="text-right text-base font-semibold">
                Total
              </TableCell>
              <TableCell className={`text-right text-base font-semibold ${cancelled ? "line-through" : ""}`}>
                Rs {formatMoney(inv.total)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {inv.creditOverride && (
        <p className="mt-3 text-sm text-muted-foreground">Issued over the customer’s credit limit by an admin.</p>
      )}

      {paid.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Payments applied</h2>
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {paid.map((p) => (
              <li key={p.paymentId} className={`flex justify-between px-4 py-2 ${p.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}>
                <span>
                  {p.number}, {formatDate(p.paymentDate)}
                </span>
                <span className="tabular-nums">Rs {formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TotalRow({ cols, label, value }: { cols: number; label: string; value: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-right">
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
