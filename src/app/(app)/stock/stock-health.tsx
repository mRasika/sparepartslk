import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { D } from "@/lib/money";
import type { AbcClass, StockAgeBand, StockHealth } from "@/lib/stock-health";
import { cn } from "@/lib/utils";

const BAND_COLOR: Record<StockAgeBand, string> = {
  "0-90": "bg-aging-1",
  "91-180": "bg-aging-2",
  "181-365": "bg-aging-3",
  "365+": "bg-aging-4",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const classLabel = (c: AbcClass) => (c === "none" ? "—" : c);

/** How much money is on the shelf, how old it is and which parts carry the sales (spec §2). */
export function StockHealthSummary({
  health: h,
  age,
  cls,
  hrefFor,
}: {
  health: StockHealth;
  age: StockAgeBand | null;
  cls: AbcClass | null;
  hrefFor: (f: { age?: StockAgeBand; cls?: AbcClass }) => string;
}) {
  const value = D(h.stockValue);
  return (
    <div className="mb-6 flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Stock value" value={`Rs ${formatMoney(h.stockValue)}`} note={`${plural(h.partsInStock, "part", "parts")} in stock`} />
        <Tile label="Slow & dead" value={`Rs ${formatMoney(h.slowValue)}`} note={`${h.slowPct}% · ${plural(h.slowParts, "part", "parts")}`} />
        <Tile label="Turns per year" value={h.turnsPerYear === null ? "—" : `${h.turnsPerYear}×`} note="last 90 days" />
        <Tile
          label="Days of stock"
          value={h.daysOfStock === null ? "—" : plural(h.daysOfStock, "day", "days")}
          note={h.daysOfStock === null ? "no sales in 90 days" : "at the current sales pace"}
        />
      </dl>

      {value.greaterThan(0) && (
        <section aria-labelledby="stock-age" className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 id="stock-age" className="text-sm text-muted-foreground">
            How long since it sold
          </h2>
          <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {h.bands
              .filter((b) => D(b.value).greaterThan(0))
              .map((b) => (
                <div key={b.key} className={BAND_COLOR[b.key]} style={{ width: `${D(b.value).div(value).times(100).toFixed(2)}%` }} />
              ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-1 text-sm">
            {h.bands.map((b) => (
              <li key={b.key}>
                <FilterLink href={hrefFor({ age: b.key })} active={age === b.key}>
                  <span className={cn("inline-block size-2.5 rounded-sm", BAND_COLOR[b.key])} aria-hidden />
                  {b.label} · Rs {formatMoney(b.value)}
                </FilterLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {h.classes.some((c) => c.parts > 0) && (
        <section aria-labelledby="sales-classes" className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 id="sales-classes" className="text-sm text-muted-foreground">
            Sales classes (last 12 months)
          </h2>
          <ul className="mt-2 flex flex-col gap-0.5 text-sm">
            {h.classes
              .filter((c) => c.parts > 0)
              .map((c) => (
                <li key={c.key}>
                  <FilterLink href={hrefFor({ cls: c.key })} active={cls === c.key}>
                    {c.label} · {plural(c.parts, "part", "parts")}
                    {c.salesPct !== null && ` · ${c.salesPct}% of sales`} · Rs {formatMoney(c.stockValue)} in stock
                    {c.key === "A" && c.lowOrOut > 0 && (
                      <span className="font-medium text-warning-foreground"> · {c.lowOrOut} low or out of stock</span>
                    )}
                  </FilterLink>
                </li>
              ))}
          </ul>
        </section>
      )}

      {h.stuck.length > 0 && (
        <section aria-labelledby="money-stuck" className="rounded-lg border bg-card">
          <h2 id="money-stuck" className="border-b p-3 px-4 font-semibold">
            Most money stuck
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="hidden md:table-cell">Last sold</TableHead>
                <TableHead>Class</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {h.stuck.map((s) => (
                <TableRow key={s.partId}>
                  <TableCell className="max-w-56 whitespace-normal">
                    <Link href={`/parts/${s.partId}`} className="font-medium hover:underline">
                      {s.sku}
                    </Link>{" "}
                    <span className="text-muted-foreground">{s.name}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.qtyOnHand}</TableCell>
                  <TableCell className="text-right tabular-nums">Rs {formatMoney(s.value)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">{s.lastSoldOn ? formatDate(s.lastSoldOn) : "Never"}</TableCell>
                  <TableCell>{classLabel(s.cls)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}

export { classLabel };

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 tabular-nums hover:bg-muted", active && "bg-muted font-medium")}
    >
      {children}
    </Link>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{value}</dd>
      <dd className="mt-1 text-sm text-muted-foreground">{note}</dd>
    </div>
  );
}
