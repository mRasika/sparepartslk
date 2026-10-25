import { AlertTriangle, FilePlus, PackageOpen } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { attentionItems } from "@/lib/attention";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { colomboDate } from "@/lib/dates";
import { requireUser } from "@/server/auth";
import { getDashboard } from "@/server/services/dashboard";
import { countInvoiceDrafts } from "@/server/services/invoice-drafts";
import { NeedsAttention } from "./needs-attention";
import { ResolveIssueButton } from "./resolve-issue-button";
import { type SalesParams, SalesSection, SalesSectionSkeleton } from "./sales-section";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SalesParams> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [d, draftCount] = await Promise.all([getDashboard(user), countInvoiceDrafts()]);
  const today = colomboDate();
  const attention = attentionItems({ ...d, draftCount });

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Today <span className="text-base font-normal text-muted-foreground">· {formatDate(today)}</span>
          </h1>
          <p className="mt-1 text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">Rs {formatMoney(d.todaySales)}</span> sold
            today · {d.todayInvoiceCount} {d.todayInvoiceCount === 1 ? "invoice" : "invoices"}
            {d.todayInvoiceCount > 0 && (
              <>
                {" · "}
                <Link href={`/invoices?from=${today}&to=${today}`} className="text-primary hover:underline">
                  View
                </Link>
              </>
            )}
          </p>
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
        <section role="alert" className="rounded-lg border border-warning bg-warning/15 p-4">
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

      <NeedsAttention items={attention.items} owedNote={attention.owedNote} />

      {user.role === "admin" && (
        // Keyed by the query so changing the period re-suspends here, not the whole page.
        <Suspense key={JSON.stringify(params)} fallback={<SalesSectionSkeleton />}>
          <SalesSection user={user} params={params} />
        </Suspense>
      )}
    </div>
  );
}
