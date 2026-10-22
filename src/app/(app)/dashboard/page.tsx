import { AlertTriangle, Clock, FilePlus, PackageOpen } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { colomboDate } from "@/lib/dates";
import { D } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth";
import { getDashboard } from "@/server/services/dashboard";
import { ResolveIssueButton } from "./resolve-issue-button";

export default async function DashboardPage() {
  const user = await requireUser();
  const d = await getDashboard(user);
  const overdue = D(d.totalOverdue).greaterThan(0);

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(colomboDate())}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/grn/new" className={buttonVariants({ variant: "outline" })}>
            <PackageOpen /> Receive goods
          </Link>
          <Link href="/invoices/new" className={buttonVariants({ size: "lg" })}>
            <FilePlus /> New invoice
          </Link>
        </div>
      </div>

      {d.reconciliationIssues && d.reconciliationIssues.length > 0 && (
        <section role="alert" className="mb-6 rounded-lg border border-warning bg-warning/15 p-4">
          <h2 className="flex items-center gap-2 font-semibold text-warning-foreground">
            <AlertTriangle className="size-4" aria-hidden /> Stock check found {d.reconciliationIssues.length}{" "}
            {d.reconciliationIssues.length === 1 ? "mismatch" : "mismatches"}
          </h2>
          <p className="mt-1 text-sm">
            The stored quantity differs from the stock history. Count the shelf, fix it with a count correction, then mark it fixed.
          </p>
          <ul className="mt-3 divide-y divide-warning/40 text-sm">
            {d.reconciliationIssues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/parts/${i.partId}`} className="font-medium hover:underline">
                    {i.sku}
                  </Link>
                  : shows {i.storedQty}, history says {i.ledgerQty}
                  <span className="ml-2 text-xs text-muted-foreground">found {formatDateTime(i.detectedAt)}</span>
                </span>
                <span className="flex gap-2">
                  <Link href="/stock/adjustments/new" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    Adjust stock
                  </Link>
                  <ResolveIssueButton issueId={i.id} sku={i.sku} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Sales today" value={`Rs ${formatMoney(d.todaySales)}`} note={`${d.todayInvoiceCount} ${d.todayInvoiceCount === 1 ? "invoice" : "invoices"}`} href="/invoices" />
        <Tile
          label="Owed by customers"
          value={`Rs ${formatMoney(d.totalOutstanding)}`}
          note="All unpaid invoices"
          href="/payments?view=outstanding"
        />
        <Tile
          label="Overdue"
          value={`Rs ${formatMoney(d.totalOverdue)}`}
          note={overdue ? "Past the due date" : "Nothing overdue"}
          href="/payments?view=outstanding&overdue=1"
          status={overdue ? { icon: Clock, tone: "critical" } : undefined}
        />
        <Tile
          label="Low stock"
          value={String(d.lowStockCount)}
          note={d.lowStockCount === 1 ? "part to reorder" : "parts to reorder"}
          href="/low-stock"
          status={d.lowStockCount > 0 ? { icon: AlertTriangle, tone: "warning" } : undefined}
        />
      </dl>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  href,
  status,
}: {
  label: string;
  value: string;
  note: string;
  href: string;
  status?: { icon: typeof Clock; tone: "warning" | "critical" };
}) {
  const Icon = status?.icon;
  return (
    <Link
      href={href}
      className="group rounded-lg border bg-card p-5 transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
      <dd
        className={cn(
          "mt-1 flex items-center gap-1.5 text-sm",
          status?.tone === "critical" && "font-medium text-destructive",
          status?.tone === "warning" && "font-medium text-warning-foreground",
          !status && "text-muted-foreground",
        )}
      >
        {Icon && <Icon className={cn("size-4", status?.tone === "warning" && "text-warning")} aria-hidden />}
        {note}
      </dd>
    </Link>
  );
}
