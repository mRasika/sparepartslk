import { Plus } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
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
import { AGING_GROUPS, agingGroup, isAgingGroupKey, outstandingHref, type AgingGroupKey } from "@/lib/aging";
import { colomboDate } from "@/lib/dates";
import { formatDate, moneyColumn } from "@/lib/format";
import { D, fmt, sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth";
import { getCreditSummary } from "@/server/services/credit";
import { outstandingInvoices } from "@/server/services/customers";
import { listPayments } from "@/server/services/payments";
import { CreditSummary } from "./credit-summary";

type SearchParams = Promise<{ view?: string; q?: string; overdue?: string; late?: string; by?: string }>;

const METHOD_LABELS = { cash: "Cash", bank: "Bank", cheque: "Cheque" } as const;

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const { view = "payments", q = "", overdue = "", late, by } = await searchParams;
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
              scroll={false}
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
      {/* Each view keeps its search, summary and buttons on screen; only the part a click
          changes reloads, in its own boundary keyed by what it depends on. */}
      {showOutstanding ? (
        <Outstanding
          overdueOnly={overdue === "1"}
          late={isAgingGroupKey(late) ? late : null}
          by={by === "overdue" ? "overdue" : "owed"}
        />
      ) : (
        <Received q={q} />
      )}
    </div>
  );
}

function BlockSkeleton({ label, className }: { label: string; className: string }) {
  return <div role="status" aria-label={label} className={cn("animate-pulse rounded-lg border bg-card", className)} />;
}

function Received({ q }: { q: string }) {
  return (
    <>
      <Form key={`form:${q}`} action="/payments" scroll={false} className="mb-4 flex gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Payment no, customer or reference" aria-label="Search payments" className="w-full sm:w-72" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </Form>
      <Suspense key={q} fallback={<BlockSkeleton label="Loading payments" className="h-72" />}>
        <ReceivedTable q={q} />
      </Suspense>
    </>
  );
}

async function ReceivedTable({ q }: { q: string }) {
  const rows = await listPayments({ q });
  const appliedColumn = moneyColumn(rows.map((p) => p.allocated));
  const amountColumn = moneyColumn(rows.map((p) => p.amount));
  return (
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
              <TableCell className="hidden text-right tabular-nums lg:table-cell">{appliedColumn(p.allocated)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", p.status === "cancelled" && "line-through")}>
                {amountColumn(p.amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Outstanding({
  overdueOnly: overdueParam,
  late,
  by,
}: {
  overdueOnly: boolean;
  late: AgingGroupKey | null;
  by: "owed" | "overdue";
}) {
  // One aging group, when chosen, wins over "Overdue only".
  const overdueOnly = overdueParam && !late;
  const lateLabel = AGING_GROUPS.find((g) => g.key === late)?.label;
  return (
    <>
      <Suspense key={by} fallback={<BlockSkeleton label="Loading summary" className="mb-6 h-56" />}>
        <SummaryBlock late={late} by={by} overdueOnly={overdueOnly} />
      </Suspense>
      <div className="mb-4 flex gap-2">
        <Link
          href={outstandingHref({ by })}
          scroll={false}
          className={buttonVariants({ variant: overdueOnly || late ? "ghost" : "secondary" })}
          aria-current={!overdueOnly && !late ? "page" : undefined}
        >
          All unpaid
        </Link>
        <Link
          href={outstandingHref({ by, overdue: true })}
          scroll={false}
          className={buttonVariants({ variant: overdueOnly ? "secondary" : "ghost" })}
          aria-current={overdueOnly ? "page" : undefined}
        >
          Overdue only
        </Link>
      </div>
      {lateLabel && (
        <p className="mb-3 text-sm text-muted-foreground">
          Showing {lateLabel} ·{" "}
          <Link href={outstandingHref({ by })} scroll={false} className="font-medium text-primary hover:underline">
            Show all
          </Link>
        </p>
      )}
      <Suspense key={`${overdueOnly}|${late}`} fallback={<BlockSkeleton label="Loading unpaid invoices" className="h-72" />}>
        <OutstandingTable overdueOnly={overdueOnly} late={late} />
      </Suspense>
    </>
  );
}

async function SummaryBlock({ late, by, overdueOnly }: { late: AgingGroupKey | null; by: "owed" | "overdue"; overdueOnly: boolean }) {
  const summary = await getCreditSummary(by, colomboDate());
  return <CreditSummary summary={summary} late={late} by={by} overdueOnly={overdueOnly} />;
}

async function OutstandingTable({ overdueOnly, late }: { overdueOnly: boolean; late: AgingGroupKey | null }) {
  const today = colomboDate();
  const all = await outstandingInvoices({ overdueOnly });
  const rows = late ? all.filter((r) => agingGroup(r.dueDate, today) === late) : all;
  const total = fmt(sum(rows.map((r) => D(r.outstanding))));
  const totalColumn = moneyColumn(rows.map((r) => r.total));
  const owedColumn = moneyColumn([...rows.map((r) => r.outstanding), total]);
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="hidden md:table-cell">Invoiced</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Total (Rs)</TableHead>
            <TableHead className="text-right">Owed (Rs)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                {late ? "Nothing in this group." : overdueOnly ? "Nothing is overdue." : "Every invoice is paid."}
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
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{totalColumn(r.total)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{owedColumn(r.outstanding)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        {rows.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="text-right font-medium">
                {late ? "Total in group" : overdueOnly ? "Total overdue" : "Total owed"}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{owedColumn(total)}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
