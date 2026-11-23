import { describe, expect, it } from "vitest";
import {
  LABEL_SIZES,
  barWidthMm,
  clampLabelCount,
  isEncodableSku,
  isLabelSize,
  labelProblem,
  printConfirmText,
} from "@/lib/labels";

describe("label fit", () => {
  it("bar width on 50 mm for 145 modules", () => expect(barWidthMm(145, "50x25")).toBeCloseTo(46 / 145));

  it("13 characters fit 50 mm", () => expect(labelProblem("ABCDEFGHIJKLM", 35 + 11 * 13, "50x25")).toBeNull());

  it("too long when the bar is under 0.19 mm", () =>
    expect(labelProblem("X".repeat(20), 35 + 11 * 20, "38x25")).toBe("too-long"));

  it("unencodable wins", () => expect(labelProblem("බ", null, "50x25")).toBe("unencodable"));
});

describe("clampLabelCount", () => {
  it.each<[string | number, number]>([
    ["", 0],
    ["-3", 0],
    ["abc", 0],
    ["2.7", 0],
    ["7", 7],
    [100000, 999],
    [12, 12],
    [-1, 0],
  ])("clampLabelCount(%j) = %j", (v, n) => expect(clampLabelCount(v)).toBe(n));
});

describe("sizes and SKUs", () => {
  it("knows the sizes", () => {
    expect(isLabelSize("40x30")).toBe(true);
    expect(isLabelSize("60x40")).toBe(false);
    expect(LABEL_SIZES["50x25"]).toMatchObject({ width: 50, height: 25 });
  });

  it("encodes printable ASCII only", () => {
    expect(isEncodableSku("BRK-001 /A")).toBe(true);
    expect(isEncodableSku("බ-1")).toBe(false);
    expect(isEncodableSku("")).toBe(false);
  });
});

describe("printConfirmText", () => {
  it("asks only for more than 50 labels", () => {
    expect(printConfirmText(0)).toBeNull();
    expect(printConfirmText(50)).toBeNull();
    expect(printConfirmText(51)).toBe("Print 51 labels?");
    expect(printConfirmText(340)).toBe("Print 340 labels?");
  });
});
