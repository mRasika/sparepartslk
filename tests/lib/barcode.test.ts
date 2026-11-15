import { describe, expect, it } from "vitest";
import { renderSkuBarcode } from "@/server/barcode";

describe("renderSkuBarcode", () => {
  it("renders a 10-character SKU as Code 128 of 145 modules", () => {
    // start 11 + 10 × 11 + check 11 + stop 13
    const r = renderSkuBarcode("BRK-PAD-FZ")!;
    expect(r.modules).toBe(145);
    expect(r.svg).toMatch(/^<svg[^>]*preserveAspectRatio="none"/);
    expect(r.svg).not.toMatch(/<text/);
  });

  it("is the same every time", () => expect(renderSkuBarcode("A-1")).toEqual(renderSkuBarcode("A-1")));

  it("returns null for a SKU with non-ASCII letters", () => expect(renderSkuBarcode("බ්රේක්-1")).toBeNull());
});
