import { Plus } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { Amount } from "@/components/amount";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { colomboDate } from "@/lib/dates";
import { formatDate, formatDayMonth, moneyColumn } from "@/lib/format";
import { D, fmt, sum } from "@/lib/money";
import { isDate } from "@/lib/periods";
import { requireUser } from "@/server/auth";
import { listReturns } from "@/server/services/returns";

type SearchParams = Promise<{ from?: string; to?: string }>;

export default async function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const params = await searchParams;
  // Ignore anything that isn't a real date; a reversed range is read the right way round.
  let from = isDate(params.from ?? "") ? params.from! : "";
  let to = isDate(params.to ?? "") ? params.to! : "";
  if (from && to && from > to) [from, to] = [to, from];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Returns"
        description="Credit notes for goods brought back. A return counts on the day it happens, so it lowers that day's net sales."
        actions={
          <Link href="/returns/new" className={buttonVariants()}>
            <Plus /> Return items
          </Link>
        }
      />
      {/* next/form searches inside the app (no full reload). Keyed so Clear empties the boxes; the key
          differs from the list's below, as siblings sharing a key get duplicated by React. */}
      <Form key={`form:${from}|${to}`} action="/returns" className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input type="date" name="from" defaultValue={from} aria-label="From date" className="w-auto" />
        <Input type="date" name="to" defaultValue={to} aria-label="To date" className="w-auto" />
        <Button type="submit" variant="secondary">
          Show
        </Button>
        {(from || to) && (
          <Link href="/returns" className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </Form>
      {/* Keyed by the dates so only the list reloads when they change. */}
      <Suspense key={`${from}|${to}`} fallback={<ListSkeleton />}>
        <ReturnsList from={from} to={to} />
      </Suspense>
    </div>
  );
}

async function ReturnsList({ from, to }: { from: string; to: string }) {
  const rows = await listReturns({ from: from || undefined, to: to || undefined });
  const today = colomboDate();
  const totalColumn = moneyColumn(rows.map((r) => r.total));
  const filtered = Boolean(from || to);
  const day = (d: string) => formatDayMonth(d, today);
  const period =
    from && to ? (from === to ? `on ${day(from)}` : `${day(from)} – ${day(to)}`) : from ? `from ${day(from)}` : `up to ${day(to)}`;

  return (
    <>
      {filtered && rows.length > 0 && (
        <p className="mb-3 text-sm">
          <span className="font-medium">
            {rows.length} {rows.length === 1 ? "return" : "returns"} {period}
          </span>{" "}
          · <Amount value={fmt(sum(rows.map((r) => D(r.total))))} className="font-medium tabular-nums" /> credited
        </p>
      )}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Credit note</TableHead>
              <TableHead className="hidden sm:table-cell">Date</TableHead>
              <TableHead>Undoes</TableHead>
              <TableHead className="hidden md:table-cell">Customer</TableHead>
              <TableHead className="hidden lg:table-cell">Reason</TableHead>
              <TableHead className="text-right">
                <span className="sm:hidden">Rs</span>
                <span className="hidden sm:inline">Credit (Rs)</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {filtered ? `No returns ${period}.` : "No returns yet."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <Link href={`/returns/${r.id}`} className="hover:underline">
                    {r.number}
                  </Link>
                  <span className="block text-xs font-normal text-muted-foreground sm:hidden">{day(r.returnDate)}</span>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap sm:table-cell">
                  <time dateTime={r.returnDate} title={formatDate(r.returnDate)}>
                    {day(r.returnDate)}
                  </time>
                </TableCell>
                <TableCell>
                  <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">
                    {r.invoiceNumber}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    sold <time dateTime={r.invoiceDate}>{day(r.invoiceDate)}</time>
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">{r.customerName}</TableCell>
                <TableCell className="hidden max-w-64 whitespace-normal text-muted-foreground lg:table-cell">{r.reason}</TableCell>
                <TableCell className="text-right tabular-nums">{totalColumn(r.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse">
      <div className="h-72 rounded-lg border bg-card" />
    </div>
  );
}
