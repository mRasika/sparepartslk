import { ClipboardList, Plus } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
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
import { StockLevel } from "@/components/stock-level";
import { colomboDate } from "@/lib/dates";
import { formatDate, formatSince, moneyColumn } from "@/lib/format";
import { D, fmt, sum } from "@/lib/money";
import {
  ABC_CLASSES,
  isAbcClass,
  isStockAgeBand,
  STOCK_AGE_BANDS,
  type AbcClass,
  type StockAgeBand,
  type StockHealth,
} from "@/lib/stock-health";
import { requireUser, type SessionUser } from "@/server/auth";
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
  // Started once and shared by the summary and the list, which both need it.
  const health = isAdmin ? getStockHealth(user) : null;
  const categories = await listCategories();
  const filterKey = JSON.stringify({ q, category, low, age, cls });
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
      {isAdmin && health && (
        <Suspense fallback={<HealthSkeleton />}>
          <HealthBlock health={health} age={age} cls={cls} hrefFor={hrefFor} />
        </Suspense>
      )}
      {/* Keyed by the filters so it shows the new values after a filter link or "Show all". */}
      <Form key={`form:${filterKey}`} action="/stock" scroll={false} className="mb-4 flex flex-wrap items-center gap-2" role="search">
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
      </Form>
      {filterLabel && (
        <p className="mb-3 text-sm text-muted-foreground">
          Showing {filterLabel} ·{" "}
          <Link href={hrefFor({})} scroll={false} className="font-medium text-primary hover:underline">
            Show all
          </Link>
        </p>
      )}
      {/* Only the list reloads when a filter changes; the summary and the search stay on screen. */}
      <Suspense key={filterKey} fallback={<TableSkeleton />}>
        <StockTable user={user} health={health} q={q} category={category} low={low} age={age} cls={cls} />
      </Suspense>
    </div>
  );
}

async function HealthBlock({
  health,
  ...props
}: {
  health: Promise<StockHealth>;
  age: StockAgeBand | null;
  cls: AbcClass | null;
  hrefFor: (f: { age?: StockAgeBand; cls?: AbcClass }) => string;
}) {
  return <StockHealthSummary health={await health} {...props} />;
}

async function StockTable({
  user,
  health: healthPromise,
  q,
  category,
  low,
  age,
  cls,
}: {
  user: SessionUser;
  health: Promise<StockHealth> | null;
  q: string;
  category: string;
  low: string;
  age: StockAgeBand | null;
  cls: AbcClass | null;
}) {
  const isAdmin = user.role === "admin";
  const health = await healthPromise;
  // A band or class narrows the list in SQL (by part id), so the list's row limit comes after it.
  const partIds =
    health && (age || cls)
      ? Object.entries(health.byPart)
          .filter(([, h]) => (age ? h.band === age : h.cls === cls))
          .map(([id]) => id)
      : undefined;
  const rows = await stockList(user, { q, categoryId: category || undefined, lowOnly: low === "1", partIds });
  const partHealth = (id: string) => health?.byPart[id] ?? { lastSoldOn: null, band: null, cls: "none" as const };
  const totalValue = isAdmin ? fmt(sum(rows.map((r) => D(r.stockValue ?? "0")))) : null;
  const avgCost = moneyColumn(rows.map((r) => r.avgCost));
  const valueColumn = moneyColumn([...rows.map((r) => r.stockValue), totalValue]);
  const today = colomboDate();

  return (
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:table-cell">SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden lg:table-cell">Category</TableHead>
              <TableHead className="hidden md:table-cell">Bin</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Reorder at</TableHead>
              {isAdmin && <TableHead className="hidden text-right md:table-cell">Avg cost (Rs)</TableHead>}
              {isAdmin && <TableHead className="text-right">Value (Rs)</TableHead>}
              {isAdmin && <TableHead className="hidden md:table-cell">Last sold</TableHead>}
              {isAdmin && <TableHead className="hidden sm:table-cell">Class</TableHead>}
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
              const lastSold = partHealth(r.id).lastSoldOn;
              return (
                <TableRow key={r.id} className={r.isActive ? "" : "text-muted-foreground"}>
                  <TableCell className="hidden font-medium sm:table-cell">
                    <Link href={`/parts/${r.id}`} className="hover:underline">
                      {r.sku}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link href={`/parts/${r.id}`} className="block text-xs font-medium text-muted-foreground hover:underline sm:hidden">
                      {r.sku}
                    </Link>
                    {r.name}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{r.categoryName}</TableCell>
                  <TableCell className="hidden md:table-cell">{r.binLocation}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <StockLevel qty={r.qtyOnHand} reorderLevel={r.reorderLevel} active={r.isActive} />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.reorderLevel || "–"}</TableCell>
                  {isAdmin && <TableCell className="hidden text-right tabular-nums md:table-cell">{avgCost(r.avgCost)}</TableCell>}
                  {isAdmin && <TableCell className="text-right tabular-nums">{valueColumn(r.stockValue)}</TableCell>}
                  {isAdmin && (
                    <TableCell className="hidden whitespace-nowrap md:table-cell">
                      {lastSold ? (
                        <time dateTime={lastSold} title={formatDate(lastSold)}>
                          {formatSince(lastSold, today)}
                        </time>
                      ) : (
                        "Never"
                      )}
                    </TableCell>
                  )}
                  {isAdmin && <TableCell className="hidden sm:table-cell">{classLabel(partHealth(r.id).cls)}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
          {isAdmin && rows.length > 0 && (
            <TableFooter>
              {/* Columns hide below lg, so the total gets its own one-cell row there. */}
              <TableRow className="lg:hidden">
                <TableCell colSpan={10}>
                  <span className="flex flex-wrap justify-between gap-2 font-medium">
                    Stock value of the parts shown
                    <span className="font-semibold tabular-nums">{valueColumn(totalValue)}</span>
                  </span>
                </TableCell>
              </TableRow>
              <TableRow className="hidden lg:table-row">
                <TableCell colSpan={7} className="text-right font-medium">
                  Stock value of the parts shown
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{valueColumn(totalValue)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
    </div>
  );
}

function HealthSkeleton() {
  return <div role="status" aria-label="Loading stock health" className="mb-6 h-40 animate-pulse rounded-lg border bg-card" />;
}

function TableSkeleton() {
  return <div role="status" aria-label="Loading stock" className="h-72 animate-pulse rounded-lg border bg-card" />;
}
