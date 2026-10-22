import { Download, PackageOpen } from "lucide-react";
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
import { requireUser } from "@/server/auth";
import { lowStock, type LowStockRow } from "@/server/services/inventory";

export default async function LowStockPage() {
  await requireUser();
  const rows = await lowStock();

  const groups = new Map<string, LowStockRow[]>();
  for (const r of rows) {
    const key = r.lastSupplierName ?? "No supplier yet";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Low stock"
        description="Active parts at or below their reorder level, grouped by the supplier you last bought from."
        actions={
          rows.length > 0 && (
            <>
              <a href="/api/low-stock/csv" className={buttonVariants({ variant: "outline" })} download>
                <Download /> Download CSV
              </a>
              <Link href="/grn/new" className={buttonVariants()}>
                <PackageOpen /> Receive goods
              </Link>
            </>
          )
        }
      />
      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Nothing is low. Parts appear here when stock drops to their reorder level.
        </p>
      ) : (
        <div className="grid gap-6">
          {[...groups.entries()].map(([supplier, items]) => (
            <section key={supplier}>
              <h2 className="mb-2 text-base font-semibold">
                {supplier} <span className="font-normal text-muted-foreground">({items.length})</span>
              </h2>
              <div className="rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden md:table-cell">OEM no</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Reorder at</TableHead>
                      <TableHead className="text-right">Order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((r) => (
                      <TableRow key={r.partId}>
                        <TableCell className="font-medium">
                          <Link href={`/parts/${r.partId}`} className="hover:underline">
                            {r.sku}
                          </Link>
                        </TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="hidden md:table-cell">{r.oemPartNo}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.qtyOnHand === 0 ? "font-semibold text-destructive" : ""}`}>
                          {r.qtyOnHand}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.reorderLevel}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{r.suggestedQty}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
