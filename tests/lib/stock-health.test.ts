import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import {
  abcClasses,
  isAbcClass,
  isStockAgeBand,
  stockAgeBand,
  summarizeStock,
  type StockPartInput,
} from "@/lib/stock-health";

const T = "2026-10-26";

const part = (p: Partial<StockPartInput> & Pick<StockPartInput, "partId" | "qtyOnHand" | "avgCost">): StockPartInput => ({
  sku: p.partId.replace("P", "S"),
  name: `Part ${p.partId}`,
  reorderLevel: 0,
  isActive: true,
  lastSoldOn: null,
  firstArrivalOn: null,
  ...p,
});

describe("stockAgeBand", () => {
  it.each([
    [0, "0-90"],
    [90, "0-90"],
    [91, "91-180"],
    [180, "91-180"],
    [181, "181-365"],
    [365, "181-365"],
    [366, "365+"],
  ])("puts %i days in %s", (days, band) => {
    expect(stockAgeBand(days)).toBe(band);
  });

  it("recognises band and class keys", () => {
    expect(isStockAgeBand("181-365")).toBe(true);
    expect(isStockAgeBand("abc")).toBe(false);
    expect(isStockAgeBand(undefined)).toBe(false);
    expect(isAbcClass("none")).toBe(true);
    expect(isAbcClass("D")).toBe(false);
  });
});

describe("abcClasses", () => {
  it("splits sales 80 / 15 / 5", () => {
    const m = abcClasses([
      { partId: "p1", sku: "a", sales: "500.00" },
      { partId: "p2", sku: "b", sales: "300.00" },
      { partId: "p3", sku: "c", sales: "100.00" },
      { partId: "p4", sku: "d", sales: "60.00" },
      { partId: "p5", sku: "e", sales: "40.00" },
    ]);
    expect(Object.fromEntries(m)).toEqual({ p1: "A", p2: "A", p3: "B", p4: "B", p5: "C" });
  });

  it("treats zero net sales as no sales", () => {
    const m = abcClasses([
      { partId: "p1", sku: "a", sales: "100.00" },
      { partId: "p2", sku: "b", sales: "0.00" },
      { partId: "p3", sku: "c", sales: "-50.00" },
    ]);
    expect(Object.fromEntries(m)).toEqual({ p1: "A" });
  });
});

describe("summarizeStock", () => {
  const parts: StockPartInput[] = [
    part({ partId: "P1", qtyOnHand: 10, avgCost: "100.00", lastSoldOn: addDays(T, -10) }),
    part({ partId: "P2", qtyOnHand: 5, avgCost: "200.00", reorderLevel: 5, lastSoldOn: addDays(T, -100) }),
    part({ partId: "P3", qtyOnHand: 4, avgCost: "500.00", lastSoldOn: addDays(T, -200) }),
    part({ partId: "P4", qtyOnHand: 2, avgCost: "1500.00", firstArrivalOn: addDays(T, -400) }),
    part({ partId: "P5", qtyOnHand: 0, avgCost: "100.00", lastSoldOn: addDays(T, -5) }),
  ];
  const sales12 = [
    { partId: "P1", sales: "500.00" },
    { partId: "P2", sales: "300.00" },
    { partId: "P5", sales: "100.00" },
    { partId: "P3", sales: "60.00" },
  ];

  it("summarizes a shop", () => {
    const h = summarizeStock({ today: T, parts, sales12, cogs90: "900.00" });
    expect(h).toMatchObject({
      stockValue: "7000.00",
      partsInStock: 4,
      slowValue: "5000.00",
      slowPct: 71,
      slowParts: 2,
      turnsPerYear: "0.5",
      daysOfStock: 700,
    });
    expect(h.bands.map((b) => b.value)).toEqual(["1000.00", "1000.00", "2000.00", "3000.00"]);
    expect(h.bands.map((b) => b.parts)).toEqual([1, 1, 1, 1]);
    expect(h.classes.map(({ key, parts: n, salesPct, stockValue, lowOrOut }) => ({ key, n, salesPct, stockValue, lowOrOut }))).toEqual([
      { key: "A", n: 2, salesPct: 83, stockValue: "2000.00", lowOrOut: 1 },
      { key: "B", n: 2, salesPct: 17, stockValue: "2000.00", lowOrOut: 1 },
      { key: "C", n: 0, salesPct: 0, stockValue: "0.00", lowOrOut: 0 },
      { key: "none", n: 1, salesPct: null, stockValue: "3000.00", lowOrOut: 0 },
    ]);
    expect(h.stuck.map((s) => s.sku)).toEqual(["S4", "S3"]);
    expect(h.byPart.P5).toEqual({ lastSoldOn: addDays(T, -5), band: null, cls: "B" });
    expect(h.byPart.P4).toEqual({ lastSoldOn: null, band: "365+", cls: "none" });
  });

  it("cuts the stuck list at 10", () => {
    const old = Array.from({ length: 12 }, (_, i) =>
      part({ partId: `P${i + 1}`, qtyOnHand: 1, avgCost: `${(i + 1) * 100}.00`, firstArrivalOn: addDays(T, -400) }),
    );
    const h = summarizeStock({ today: T, parts: old, sales12: [], cogs90: "0.00" });
    expect(h.stuck).toHaveLength(10);
    expect(h.stuck[0].value).toBe("1200.00");
  });

  it("ages a part with no arrival and no sale as new", () => {
    const h = summarizeStock({ today: T, parts: [part({ partId: "P1", qtyOnHand: 1, avgCost: "10.00" })], sales12: [], cogs90: "0.00" });
    expect(h.byPart.P1.band).toBe("0-90");
  });

  it("has no days of stock without sales", () => {
    const h = summarizeStock({ today: T, parts: [parts[0]], sales12: [], cogs90: "0.00" });
    expect(h).toMatchObject({ turnsPerYear: "0.0", daysOfStock: null });
  });

  it("summarizes an empty shop", () => {
    const h = summarizeStock({ today: T, parts: [], sales12: [], cogs90: "0.00" });
    expect(h).toMatchObject({ stockValue: "0.00", slowPct: 0, turnsPerYear: null, daysOfStock: null, stuck: [] });
    expect(h.bands.map((b) => [b.value, b.parts])).toEqual(Array(4).fill(["0.00", 0]));
  });
});
