import { describe, expect, it } from "vitest";
import { bumpQty, findExactMatches, scanLookupUrl } from "@/lib/scan";

describe("findExactMatches", () => {
  const rows = [
    { sku: "BRK-001", barcode: null, oemPartNo: "X1" },
    { sku: "BRK-0011", barcode: "8901234567890", oemPartNo: null },
    { sku: "OIL-1", barcode: "brk-001x", oemPartNo: "BRK-001" },
  ];

  it("matches SKU ignoring case and spaces", () =>
    expect(findExactMatches(rows, " brk-001 ").map((r) => r.sku)).toEqual(["BRK-001"]));

  it("matches barcode", () =>
    expect(findExactMatches(rows, "8901234567890").map((r) => r.sku)).toEqual(["BRK-0011"]));

  it("ignores OEM numbers and prefixes", () => {
    expect(findExactMatches(rows, "X1")).toEqual([]);
    expect(findExactMatches(rows, "BRK-00")).toEqual([]);
  });

  it("returns both when one SKU equals another's barcode", () =>
    expect(
      findExactMatches(
        [
          { sku: "A1", barcode: null },
          { sku: "B2", barcode: "a1" },
        ],
        "A1",
      ),
    ).toHaveLength(2));

  it("empty code matches nothing", () => expect(findExactMatches(rows, "  ")).toEqual([]));
});

describe("bumpQty", () => {
  it.each([
    ["", "1"],
    ["1", "2"],
    ["0", "1"],
    ["-2", "-3"],
    [" 4 ", "5"],
    ["1.5", "1.5"],
    ["abc", "abc"],
  ])("%j → %j", (from, to) => expect(bumpQty(from)).toBe(to));
});

describe("scanLookupUrl", () => {
  it("encodes the code and never carries filters", () => {
    const url = new URL(scanLookupUrl("A B&C", "cust-1"), "http://x");
    expect(url.pathname).toBe("/api/parts/search");
    expect(url.searchParams.get("q")).toBe("A B&C");
    expect(url.searchParams.get("customerId")).toBe("cust-1");
    expect(url.searchParams.has("categoryId")).toBe(false);
    expect(url.searchParams.has("vehicleModelId")).toBe(false);
  });

  it("leaves out customerId when absent", () =>
    expect(new URL(scanLookupUrl("A"), "http://x").searchParams.has("customerId")).toBe(false));
});
