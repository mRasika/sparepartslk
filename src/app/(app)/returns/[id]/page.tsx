import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getReturn } from "@/server/services/returns";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  let ret: Awaited<ReturnType<typeof getReturn>>;
  try {
    ret = await getReturn(id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const adjusted = ret.subtotal !== ret.total;

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Credit note ${ret.number}`} description={`${formatDate(ret.returnDate)}, ${ret.customerName}`} />
      <dl className="mb-6 grid grid-cols-2 gap-4 rounded-lg border bg-card p-5 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Invoice</dt>
          <dd>
            <Link href={`/invoices/${ret.invoiceId}`} className="font-medium hover:underline">
              {ret.invoiceNumber}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Customer</dt>
          <dd>
            <Link href={`/customers/${ret.customerId}`} className="hover:underline">
              {ret.customerName}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Money back</dt>
          <dd>
            {ret.refund
              ? `${ret.refund.method === "cash" ? "Cash" : "Bank"} refund ${ret.refund.number}`
              : "Kept as account credit"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Recorded by</dt>
          <dd>{ret.createdByName}</dd>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <dt className="text-xs text-muted-foreground">Reason</dt>
          <dd>{ret.reason}</dd>
        </div>
      </dl>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ret.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <div className="font-medium">{i.sku}</div>
                  <div className="text-xs text-muted-foreground">{i.description}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.unitPrice)}</TableCell>
                <TableCell>{i.restock ? "Back in stock" : "Damaged, not restocked"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="tabular-nums">
            {adjusted && (
              <TableRow>
                <TableCell colSpan={4} className="text-right">
                  Items
                </TableCell>
                <TableCell className="text-right">{formatMoney(ret.subtotal)}</TableCell>
              </TableRow>
            )}
            <TableRow>
              <TableCell colSpan={4} className="text-right font-semibold">
                Credit{adjusted ? " (after invoice discount and VAT)" : ""}
              </TableCell>
              <TableCell className="text-right font-semibold">Rs {formatMoney(ret.total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
