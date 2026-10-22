import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { D, fmt, sum } from "@/lib/money";
import { requireUser } from "@/server/auth";
import { listCategories } from "@/server/services/catalog";
import { stockList } from "@/server/services/inventory";

type SearchParams = Promise<{ q?: string; category?: string; low?: string }>;

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { q = "", category = "", low = "" } = await searchParams;
  const [rows, categories] = await Promise.all([
    stockList(user, { q, categoryId: category || undefined, lowOnly: low === "1" }),
    listCategories(),
  ]);
  const isAdmin = user.role === "admin";
  const totalValue = isAdmin ? fmt(sum(rows.map((r) => D(r.stockValue ?? "0")))) : null;

  return (
    <div>
      <PageHeader
        title="Stock"
        description="What is on the shelves now."
        actions={
          <>
            <Link href="/stock/adjustments" className={buttonVariants({ variant: "outline" })}>
              <ClipboardList /> Adjustments
            </Link>
            <Link href="/stock/adjustments/new" className={buttonVariants()}>
              <Plus /> Adjust stock
            </Link>
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="SKU, name or OEM no" aria-label="Search stock" className="w-full sm:w-64" />
        <NativeSelect name="category" defaultValue={category} aria-label="Category">
          <NativeSelectOption value="">All categories</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>
              {c.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" name="low" value="1" defaultChecked={low === "1"} className="size-4 accent-primary" />
          Low only
        </label>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden lg:table-cell">Category</TableHead>
              <TableHead className="hidden md:table-cell">Bin</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Reorder at</TableHead>
              {isAdmin && <TableHead className="hidden text-right md:table-cell">Avg cost</TableHead>}
              {isAdmin && <TableHead className="text-right">Value (Rs)</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No parts match.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const isLow = r.isActive && r.reorderLevel > 0 && r.qtyOnHand <= r.reorderLevel;
              return (
                <TableRow key={r.id} className={r.isActive ? "" : "text-muted-foreground"}>
                  <TableCell className="font-medium">
                    <Link href={`/parts/${r.id}`} className="hover:underline">
                      {r.sku}
                    </Link>
                  </TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="hidden lg:table-cell">{r.categoryName}</TableCell>
                  <TableCell className="hidden md:table-cell">{r.binLocation}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={isLow ? "rounded bg-warning/25 px-1.5 py-0.5 font-medium" : ""}>{r.qtyOnHand}</span>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.reorderLevel || "–"}</TableCell>
                  {isAdmin && <TableCell className="hidden text-right tabular-nums md:table-cell">{formatMoney(r.avgCost)}</TableCell>}
                  {isAdmin && <TableCell className="text-right tabular-nums">{formatMoney(r.stockValue)}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
          {isAdmin && rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={7} className="text-right font-medium">
                  Stock value of the parts shown
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatMoney(totalValue)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
