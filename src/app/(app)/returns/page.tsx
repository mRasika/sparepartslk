import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { listReturns } from "@/server/services/returns";

export default async function ReturnsPage() {
  await requireUser();
  const rows = await listReturns();

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Returns"
        description="Credit notes for goods brought back."
        actions={
          <Link href="/returns/new" className={buttonVariants()}>
            <Plus /> Return items
          </Link>
        }
      />
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Credit note</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Credit (Rs)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No returns yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <Link href={`/returns/${r.id}`} className="hover:underline">
                    {r.number}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.returnDate)}</TableCell>
                <TableCell>
                  <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">
                    {r.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
