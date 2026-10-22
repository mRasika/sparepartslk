import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/amount-in-words";

describe("amountInWords", () => {
  it("spells rupees and cents", () => {
    expect(amountInWords("1250.50")).toBe("Rupees One Thousand Two Hundred Fifty and Cents Fifty Only");
  });

  it("uses international (thousand/million) grouping", () => {
    expect(amountInWords("100000.00")).toBe("Rupees One Hundred Thousand Only");
    expect(amountInWords("2015300.00")).toBe("Rupees Two Million Fifteen Thousand Three Hundred Only");
  });

  it("handles less than one rupee", () => {
    expect(amountInWords("0.75")).toBe("Rupees Zero and Cents Seventy Five Only");
  });

  it("handles teens and exact tens", () => {
    expect(amountInWords("19.00")).toBe("Rupees Nineteen Only");
    expect(amountInWords("90.05")).toBe("Rupees Ninety and Cents Five Only");
  });
});
