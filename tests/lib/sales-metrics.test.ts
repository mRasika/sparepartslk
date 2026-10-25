import { describe, expect, it } from "vitest";
import { avgSale, marginPct, pctChange, pointsChange } from "@/lib/sales-metrics";

describe("sales metrics", () => {
  it("gives the margin to one decimal", () => {
    expect(marginPct("1000.00", "251.00")).toBe("25.1");
  });

  it("has no margin without positive sales", () => {
    expect(marginPct("0.00", "0.00")).toBeNull();
    expect(marginPct("-500.00", "-200.00")).toBeNull();
  });

  it("gives the change as a whole percent", () => {
    expect(pctChange("1120.00", "1000.00")).toBe("12");
    expect(pctChange("920.00", "1000.00")).toBe("-8");
  });

  it("has no percent change when there was nothing before", () => {
    expect(pctChange("500.00", "0.00")).toBeNull();
  });

  it("gives the margin change in points", () => {
    expect(pointsChange("25.1", "26.0")).toBe("-0.9");
    expect(pointsChange(null, "26.0")).toBeNull();
  });

  it("averages invoice sales", () => {
    expect(avgSale("9000.00", 0)).toBe("0.00");
    expect(avgSale("10000.00", 3)).toBe("3333.33");
  });
});
