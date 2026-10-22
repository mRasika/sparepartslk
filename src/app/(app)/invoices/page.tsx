import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { listInvoices } from "@/server/services/invoicing";

type SearchParams = Promise<{ q?: string; status?: string; from?: string; to?: string }>;

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const { q = "", status = "", from = "", to = "" } = await searchParams;
  const rows = await listInvoices({
    q,
    status: status === "issued" || status === "cancelled" ? status : undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const filtered = Boolean(q || status || from || to);

  return (
    <div>
      <PageHeader
        title="Invoices"
        actions={
          <Link href="/invoices/new" className={buttonVariants()}>
            <Plus /> New invoice
          </Link>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Invoice no or customer" aria-label="Search invoices" className="w-full sm:w-64" />
        <NativeSelect name="status" defaultValue={status} aria-label="Status">
          <NativeSelectOption value="">All</NativeSelectOption>
          <NativeSelectOption value="issued">Issued</NativeSelectOption>
          <NativeSelectOption value="cancelled">Cancelled</NativeSelectOption>
        </NativeSelect>
        <Input type="date" name="from" defaultValue={from} aria-label="From date" className="w-auto" />
        <Input type="date" name="to" defaultValue={to} aria-label="To date" className="w-auto" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {filtered && (
          <Link href="/invoices" className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </form>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="text-right">Total (Rs)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {filtered ? "No invoices match." : "No invoices yet. Create one with New invoice."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className={r.status === "cancelled" ? "text-muted-foreground" : ""}>
                <TableCell className="font-medium">
                  <Link href={`/invoices/${r.id}`} className="hover:underline">
                    {r.number}
                  </Link>
                  {r.status === "cancelled" && (
                    <Badge variant="outline" className="ml-2">
                      Cancelled
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.invoiceDate)}</TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="hidden capitalize sm:table-cell">{r.paymentType}</TableCell>
                <TableCell className={`text-right tabular-nums ${r.status === "cancelled" ? "line-through" : ""}`}>
                  {formatMoney(r.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
