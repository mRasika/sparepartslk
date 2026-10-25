import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { marginPct } from "@/lib/sales-metrics";
import type { TopDimension, TopSellerRow, TopSort } from "@/server/services/sales-analytics";

const TABS: { value: TopDimension; label: string }[] = [
  { value: "parts", label: "Parts" },
  { value: "categories", label: "Categories" },
  { value: "brands", label: "Brands" },
  { value: "models", label: "Bike models" },
];

const SORTS: { value: TopSort; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "profit", label: "Profit" },
];

/** Top 10 by part, category, brand or bike model; tabs and sort are links that keep the period. */
export function TopSellers({
  rows,
  dimension,
  sort,
  hrefFor,
}: {
  rows: TopSellerRow[];
  dimension: TopDimension;
  sort: TopSort;
  hrefFor: (change: { top?: TopDimension; sort?: TopSort }) => string;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Top sellers by" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={hrefFor({ top: t.value })}
              scroll={false}
              aria-current={t.value === dimension ? "page" : undefined}
              className={buttonVariants({ variant: t.value === dimension ? "secondary" : "ghost", size: "sm" })}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Sort by" className="flex items-center gap-1 text-sm text-muted-foreground">
          <span className="mr-1">Sort by</span>
          {SORTS.map((s) => (
            <Link
              key={s.value}
              href={hrefFor({ sort: s.value })}
              scroll={false}
              aria-current={s.value === sort ? "page" : undefined}
              className={buttonVariants({ variant: s.value === sort ? "secondary" : "ghost", size: "sm" })}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No sales in this period</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Qty</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const margin = marginPct(r.netSales, r.grossProfit);
              return (
                <TableRow key={r.key}>
                  <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="max-w-56 whitespace-normal">
                    {r.name}
                    {r.detail && <span className="ml-2 text-xs text-muted-foreground">{r.detail}</span>}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">Rs {formatMoney(r.netSales)}</TableCell>
                  <TableCell className="text-right tabular-nums">Rs {formatMoney(r.grossProfit)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {margin === null ? "—" : `${margin}%`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {dimension === "models" && rows.length > 0 && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          A part that fits several bike models counts toward each, so these totals overlap.
        </p>
      )}
    </div>
  );
}
