import { describe, expect, it, vi } from "vitest";
import {
  bumpQty,
  createInOrder,
  findExactMatches,
  lookupProblem,
  scanLookupUrl,
  scanProblemText,
} from "@/lib/scan";

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

describe("createInOrder", () => {
  /** A promise resolved by hand, to make lookups finish in any order. */
  function later<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it("applies results in the order they were added, whatever order they arrive in", async () => {
    const queue = createInOrder();
    const applied: string[] = [];
    const a = later<string>();
    const b = later<string>();
    const doneA = queue.add(a.promise, (v) => applied.push(v));
    const doneB = queue.add(b.promise, (v) => applied.push(v));
    b.resolve("B");
    await Promise.resolve();
    expect(applied).toEqual([]);
    a.resolve("A");
    await Promise.all([doneA, doneB]);
    expect(applied).toEqual(["A", "B"]);
  });

  it("is busy only while something waits", async () => {
    const queue = createInOrder();
    expect(queue.busy).toBe(false);
    const a = later<number>();
    const done = queue.add(a.promise, () => {});
    expect(queue.busy).toBe(true);
    a.resolve(1);
    await done;
    expect(queue.busy).toBe(false);
  });

  it("keeps going after a step throws", async () => {
    const queue = createInOrder();
    const applied: number[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = queue.add(Promise.resolve(1), () => {
      throw new Error("boom");
    });
    const second = queue.add(Promise.resolve(2), (v) => applied.push(v));
    await Promise.all([first, second]);
    expect(applied).toEqual([2]);
    expect(queue.busy).toBe(false);
    error.mockRestore();
  });
});

describe("scan problems", () => {
  it("a 401 means signed out; any other failure is a lookup failure", () => {
    expect(lookupProblem(401)).toBe("signed-out");
    expect(lookupProblem(404)).toBe("failed");
    expect(lookupProblem(500)).toBe("failed");
  });

  it("each problem says what happened and what to do", () => {
    expect(scanProblemText("unknown", "X1")).toBe("No part with code “X1”");
    expect(scanProblemText("signed-out", "X1")).toBe(
      "“X1” not added: you are signed out. Sign in again in another tab, then scan it again.",
    );
    expect(scanProblemText("failed", "X1")).toBe("Couldn’t look up “X1”. Check the connection and scan it again.");
  });
});
