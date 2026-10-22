import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { D, fmt, sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth";
import { outstandingInvoices } from "@/server/services/customers";
import { listPayments } from "@/server/services/payments";

type SearchParams = Promise<{ view?: string; q?: string; overdue?: string }>;

const METHOD_LABELS = { cash: "Cash", bank: "Bank", cheque: "Cheque" } as const;

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const { view = "payments", q = "", overdue = "" } = await searchParams;
  const showOutstanding = view === "outstanding";

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Money received, and what customers still owe."
        actions={
          <Link href="/payments/new" className={buttonVariants()}>
            <Plus /> Receive payment
          </Link>
        }
      />
      <nav aria-label="Payments views" className="mb-4 inline-flex rounded-lg border bg-card p-0.5">
        {[
          { key: "payments", label: "Received", href: "/payments" },
          { key: "outstanding", label: "Outstanding", href: "/payments?view=outstanding" },
        ].map((t) => {
          const active = (t.key === "outstanding") === showOutstanding;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium",
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {showOutstanding ? <Outstanding overdueOnly={overdue === "1"} /> : <Received q={q} />}
    </div>
  );
}

async function Received({ q }: { q: string }) {
  const rows = await listPayments({ q });
  return (
    <>
      <form className="mb-4 flex gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Payment no, customer or reference" aria-label="Search payments" className="w-full sm:w-72" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payment</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Method</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Applied</TableHead>
              <TableHead className="text-right">Amount (Rs)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {q ? "No payments match." : "No payments yet."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id} className={p.status === "cancelled" ? "text-muted-foreground" : ""}>
                <TableCell className="font-medium">
                  {p.number}
                  {p.isRefund && (
                    <Badge variant="outline" className="ml-2">
                      Refund
                    </Badge>
                  )}
                  {p.status === "cancelled" && (
                    <Badge variant="outline" className="ml-2">
                      Cancelled
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(p.paymentDate)}</TableCell>
                <TableCell>
                  <Link href={`/customers/${p.customerId}`} className="hover:underline">
                    {p.customerName}
                  </Link>
                  {p.invoiceId && <div className="text-xs text-muted-foreground">With a cash invoice</div>}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {METHOD_LABELS[p.method]}
                  {p.reference && <div className="text-xs text-muted-foreground">{p.reference}</div>}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatMoney(p.allocated)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", p.status === "cancelled" && "line-through")}>
                  {formatMoney(p.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

async function Outstanding({ overdueOnly }: { overdueOnly: boolean }) {
  const rows = await outstandingInvoices({ overdueOnly });
  const total = fmt(sum(rows.map((r) => D(r.outstanding))));
  return (
    <>
      <div className="mb-4 flex gap-2">
        <Link
          href="/payments?view=outstanding"
          className={buttonVariants({ variant: overdueOnly ? "ghost" : "secondary" })}
          aria-current={!overdueOnly ? "page" : undefined}
        >
          All unpaid
        </Link>
        <Link
          href="/payments?view=outstanding&overdue=1"
          className={buttonVariants({ variant: overdueOnly ? "secondary" : "ghost" })}
          aria-current={overdueOnly ? "page" : undefined}
        >
          Overdue only
        </Link>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Invoiced</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Total</TableHead>
              <TableHead className="text-right">Owed (Rs)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {overdueOnly ? "Nothing is overdue." : "Every invoice is paid."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.invoiceId}>
                <TableCell className="font-medium">
                  <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">
                    {r.number}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/customers/${r.customerId}`} className="hover:underline">
                    {r.customerName}
                  </Link>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap md:table-cell">{formatDate(r.invoiceDate)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(r.dueDate)}
                  {r.daysOverdue > 0 && (
                    <div className="text-xs font-medium text-destructive">
                      {r.daysOverdue} {r.daysOverdue === 1 ? "day" : "days"} overdue
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatMoney(r.total)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.outstanding)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5} className="text-right font-medium">
                  {overdueOnly ? "Total overdue" : "Total owed"}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(total)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </>
  );
}
