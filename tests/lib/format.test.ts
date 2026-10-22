import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";

describe("formatMoney", () => {
  it("groups thousands and keeps 2 decimals", () => {
    expect(formatMoney("5400.00")).toBe("5,400.00");
    expect(formatMoney("1234567.5")).toBe("1,234,567.50");
    expect(formatMoney("0.75")).toBe("0.75");
    expect(formatMoney("-500.00")).toBe("-500.00");
    expect(formatMoney("100")).toBe("100.00");
  });
});
