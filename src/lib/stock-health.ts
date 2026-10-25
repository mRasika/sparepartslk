import { D, fmt, sum, type Decimal } from "@/lib/money";

export type StockAgeBand = "0-90" | "91-180" | "181-365" | "365+";
export type AbcClass = "A" | "B" | "C" | "none";

export const STOCK_AGE_BANDS: { key: StockAgeBand; label: string }[] = [
  { key: "0-90", label: "0–90 days" },
  { key: "91-180", label: "91–180 days" },
  { key: "181-365", label: "181–365 days" },
  { key: "365+", label: "Over 365 days" },
];

export const ABC_CLASSES: { key: AbcClass; label: string }[] = [
  { key: "A", label: "A" },
  { key: "B", label: "B" },
  { key: "C", label: "C" },
  { key: "none", label: "No sales" },
];

/** Bands of days since a part last sold (or arrived, if it never sold) (spec §3). */
export function stockAgeBand(days: number): StockAgeBand {
  if (days <= 90) return "0-90";
  if (days <= 180) return "91-180";
  if (days <= 365) return "181-365";
  return "365+";
}

export function isStockAgeBand(v: string | undefined): v is StockAgeBand {
  return STOCK_AGE_BANDS.some((b) => b.key === v);
}

export function isAbcClass(v: string | undefined): v is AbcClass {
  return ABC_CLASSES.some((c) => c.key === v);
}

/**
 * ABC by sales: sorted by sales (then SKU), a part is A while the share before it is under 80%,
 * B under 95%, else C. Parts without positive sales are left out (they are "No sales").
 */
export function abcClasses(rows: { partId: string; sku: string; sales: string }[]): Map<string, "A" | "B" | "C"> {
  const selling = rows
    .filter((r) => D(r.sales).greaterThan(0))
    .sort((a, b) => D(b.sales).comparedTo(a.sales) || a.sku.localeCompare(b.sku));
  const total = sum(selling.map((r) => D(r.sales)));
  const classes = new Map<string, "A" | "B" | "C">();
  let before = D(0);
  for (const r of selling) {
    const share = before.div(total);
    classes.set(r.partId, share.lessThan(0.8) ? "A" : share.lessThan(0.95) ? "B" : "C");
    before = before.plus(r.sales);
  }
  return classes;
}

export type StockPartInput = {
  partId: string;
  sku: string;
  name: string;
  qtyOnHand: number;
  avgCost: string;
  reorderLevel: number;
  isActive: boolean;
  lastSoldOn: string | null;
  firstArrivalOn: string | null;
};

/** `band` is null when the part has nothing in stock. */
export type PartHealth = { lastSoldOn: string | null; band: StockAgeBand | null; cls: AbcClass };

export type StockHealth = {
  stockValue: string;
  partsInStock: number;
  slowValue: string;
  slowPct: number;
  slowParts: number;
  /** One decimal; null when there is no stock. */
  turnsPerYear: string | null;
  /** Null when nothing sold in the last 90 days. */
  daysOfStock: number | null;
  bands: { key: StockAgeBand; label: string; value: string; parts: number }[];
  /** salesPct is null for "No sales". */
  classes: { key: AbcClass; label: string; parts: number; salesPct: number | null; stockValue: string; lowOrOut: number }[];
  stuck: { partId: string; sku: string; name: string; qtyOnHand: number; value: string; lastSoldOn: string | null; cls: AbcClass }[];
  byPart: Record<string, PartHealth>;
};

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const pct = (part: Decimal, whole: Decimal) => Number(part.div(whole).times(100).toFixed(0));
const SLOW: StockAgeBand[] = ["181-365", "365+"];

/** The Stock page's health figures from plain data (spec §3). */
export function summarizeStock(input: {
  today: string;
  parts: StockPartInput[];
  sales12: { partId: string; sales: string }[];
  cogs90: string;
}): StockHealth {
  const { today } = input;
  const skus = new Map(input.parts.map((p) => [p.partId, p.sku]));
  const classes = abcClasses(input.sales12.map((s) => ({ ...s, sku: skus.get(s.partId) ?? "" })));
  const salesOf = new Map(input.sales12.map((s) => [s.partId, D(s.sales)]));
  const totalSales = sum([...classes.keys()].map((id) => salesOf.get(id)!));

  const rows = input.parts.map((p) => {
    const inStock = p.qtyOnHand > 0;
    const value = inStock ? D(p.qtyOnHand).times(p.avgCost) : D(0);
    const band = inStock ? stockAgeBand(days(p.lastSoldOn ?? p.firstArrivalOn ?? today, today)) : null;
    const cls: AbcClass = classes.get(p.partId) ?? "none";
    const lowOrOut = p.isActive && (p.qtyOnHand === 0 || (p.reorderLevel > 0 && p.qtyOnHand <= p.reorderLevel));
    return { p, inStock, value, band, cls, lowOrOut };
  });
  const stocked = rows.filter((r) => r.inStock);
  const stockValue = sum(stocked.map((r) => r.value));
  const slow = stocked.filter((r) => r.band && SLOW.includes(r.band));
  const slowValue = sum(slow.map((r) => r.value));
  const cogs = D(input.cogs90);

  return {
    stockValue: fmt(stockValue),
    partsInStock: stocked.length,
    slowValue: fmt(slowValue),
    slowPct: stockValue.greaterThan(0) ? pct(slowValue, stockValue) : 0,
    slowParts: slow.length,
    turnsPerYear: stockValue.greaterThan(0) ? cogs.times(365).div(90).div(stockValue).toFixed(1) : null,
    daysOfStock: cogs.greaterThan(0) ? Number(stockValue.div(cogs.div(90)).toFixed(0)) : null,
    bands: STOCK_AGE_BANDS.map((b) => {
      const inBand = stocked.filter((r) => r.band === b.key);
      return { ...b, value: fmt(sum(inBand.map((r) => r.value))), parts: inBand.length };
    }),
    classes: ABC_CLASSES.map((c) => {
      // A discontinued part with no stock and no sales is gone, not a "No sales" part to act on.
      const inClass = rows.filter((r) => r.cls === c.key && !(c.key === "none" && !r.p.isActive && !r.inStock));
      const classSales = sum(inClass.map((r) => salesOf.get(r.p.partId) ?? D(0)).filter((s) => s.greaterThan(0)));
      return {
        ...c,
        parts: inClass.length,
        salesPct: c.key === "none" ? null : totalSales.greaterThan(0) ? pct(classSales, totalSales) : 0,
        stockValue: fmt(sum(inClass.map((r) => r.value))),
        lowOrOut: inClass.filter((r) => r.lowOrOut).length,
      };
    }),
    stuck: [...slow]
      .sort((a, b) => b.value.comparedTo(a.value) || a.p.sku.localeCompare(b.p.sku))
      .slice(0, 10)
      .map((r) => ({
        partId: r.p.partId,
        sku: r.p.sku,
        name: r.p.name,
        qtyOnHand: r.p.qtyOnHand,
        value: fmt(r.value),
        lastSoldOn: r.p.lastSoldOn,
        cls: r.cls,
      })),
    byPart: Object.fromEntries(rows.map((r) => [r.p.partId, { lastSoldOn: r.p.lastSoldOn, band: r.band, cls: r.cls }])),
  };
}
