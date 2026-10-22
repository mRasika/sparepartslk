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
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getGrn, type GrnDetail } from "@/server/services/grn";

export default async function GrnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let grn: GrnDetail;
  try {
    grn = await getGrn(user, id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={grn.number}
        description={`Received ${formatDate(grn.receivedDate)} from ${grn.supplierName}`}
      />
      <dl className="mb-6 grid grid-cols-2 gap-4 rounded-lg border bg-card p-5 sm:grid-cols-4">
        <Fact label="Supplier">{grn.supplierName}</Fact>
        <Fact label="Supplier invoice">{grn.supplierInvoiceNo || "None"}</Fact>
        <Fact label="Recorded by">{grn.createdByName}</Fact>
        <Fact label="Recorded at">{formatDateTime(grn.createdAt)}</Fact>
      </dl>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit cost (Rs)</TableHead>
              <TableHead className="text-right">Amount (Rs)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grn.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link href={`/parts/${i.partId}`} className="font-medium hover:underline">
                    {i.sku}
                  </Link>
                  <div className="text-xs text-muted-foreground">{i.name}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.unitCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(i.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="text-right font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatMoney(grn.total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {grn.note && <p className="mt-4 text-sm text-muted-foreground">Note: {grn.note}</p>}
      <p className="mt-6 text-sm text-muted-foreground">
        GRNs can’t be edited. Fix a mistake with a stock adjustment.
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
