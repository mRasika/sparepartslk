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
import { formatDate, formatMoney } from "@/lib/format";
import { D, fmt, sum } from "@/lib/money";
import { ABC_CLASSES, isAbcClass, isStockAgeBand, STOCK_AGE_BANDS, type AbcClass, type StockAgeBand } from "@/lib/stock-health";
import { requireUser } from "@/server/auth";
import { listCategories } from "@/server/services/catalog";
import { stockList } from "@/server/services/inventory";
import { getStockHealth } from "@/server/services/stock-health";
import { classLabel, StockHealthSummary } from "./stock-health";

type SearchParams = Promise<{ q?: string; category?: string; low?: string; age?: string; class?: string }>;

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { q = "", category = "", low = "", ...params } = await searchParams;
  const isAdmin = user.role === "admin";
  // Health filters are admin-only; for staff the params are ignored.
  const age: StockAgeBand | null = isAdmin && isStockAgeBand(params.age) ? params.age : null;
  const cls: AbcClass | null = isAdmin && !age && isAbcClass(params.class) ? params.class : null;
  const [allRows, categories, health] = await Promise.all([
    stockList(user, { q, categoryId: category || undefined, lowOnly: low === "1" }),
    listCategories(),
    isAdmin ? getStockHealth(user) : null,
  ]);
  const partHealth = (id: string) => health?.byPart[id] ?? { lastSoldOn: null, band: null, cls: "none" as const };
  const rows = allRows.filter(
    (r) => (!age || partHealth(r.id).band === age) && (!cls || partHealth(r.id).cls === cls),
  );
  /** /stock keeping the search, category and low filters; one health filter at a time. */
  const hrefFor = (f: { age?: StockAgeBand; cls?: AbcClass }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (low === "1") p.set("low", "1");
    if (f.age) p.set("age", f.age);
    if (f.cls) p.set("class", f.cls);
    const s = p.toString();
    return s ? `/stock?${s}` : "/stock";
  };
  const filterLabel = age
    ? STOCK_AGE_BANDS.find((b) => b.key === age)?.label
    : cls
      ? `class ${ABC_CLASSES.find((c) => c.key === cls)?.label}`
      : null;
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
      {health && <StockHealthSummary health={health} age={age} cls={cls} hrefFor={hrefFor} />}
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        {age && <input type="hidden" name="age" value={age} />}
        {cls && <input type="hidden" name="class" value={cls} />}
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
      {filterLabel && (
        <p className="mb-3 text-sm text-muted-foreground">
          Showing {filterLabel} ·{" "}
          <Link href={hrefFor({})} className="font-medium text-primary hover:underline">
            Show all
          </Link>
        </p>
      )}

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
              {isAdmin && <TableHead className="hidden md:table-cell">Last sold</TableHead>}
              {isAdmin && <TableHead>Class</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
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
                  {isAdmin && (
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {partHealth(r.id).lastSoldOn ? formatDate(partHealth(r.id).lastSoldOn!) : "Never"}
                    </TableCell>
                  )}
                  {isAdmin && <TableCell>{classLabel(partHealth(r.id).cls)}</TableCell>}
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
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
