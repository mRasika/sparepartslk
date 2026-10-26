import { Plus } from "lucide-react";
import Link from "next/link";
import { QuotationStatusBadge } from "@/components/billing/quotation-status-badge";
import { PageHeader } from "@/components/page-header";
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
import { QUOTATION_STATUS_LABEL, type QuotationStatus } from "@/lib/quotations";
import { requireUser } from "@/server/auth";
import { listQuotations } from "@/server/services/quotations";

type SearchParams = Promise<{ q?: string; status?: string }>;

const STATUSES = Object.keys(QUOTATION_STATUS_LABEL) as QuotationStatus[];

export default async function QuotationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const { q = "", status = "" } = await searchParams;
  const statusFilter = STATUSES.find((s) => s === status);
  const rows = await listQuotations({ q, status: statusFilter });
  const filtered = Boolean(q || statusFilter);

  return (
    <div>
      <PageHeader
        title="Quotations"
        actions={
          <Link href="/quotations/new" className={buttonVariants()}>
            <Plus /> New quotation
          </Link>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Quotation no, customer or phone"
          aria-label="Search quotations"
          className="w-full sm:w-64"
        />
        <NativeSelect name="status" defaultValue={statusFilter ?? ""} aria-label="Status">
          <NativeSelectOption value="">All</NativeSelectOption>
          {STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {QUOTATION_STATUS_LABEL[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {filtered && (
          <Link href="/quotations" className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </form>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden sm:table-cell">Valid until</TableHead>
              <TableHead className="text-right">Total (Rs)</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {filtered ? "No quotations match." : "No quotations yet."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className={r.status === "cancelled" ? "text-muted-foreground" : ""}>
                <TableCell className="font-medium">
                  <Link href={`/quotations/${r.id}`} className="hover:underline">
                    {r.number}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(r.quotationDate)}</TableCell>
                <TableCell>
                  {r.isWalkIn && r.quoteForName ? (
                    <>
                      {r.quoteForName} <span className="text-muted-foreground">walk-in</span>
                    </>
                  ) : (
                    r.customerName
                  )}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(r.validUntil)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.total)}</TableCell>
                <TableCell>
                  <QuotationStatusBadge status={r.status} invoiceNumber={r.invoiceNumber} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
