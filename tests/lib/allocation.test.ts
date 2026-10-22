import { describe, expect, it } from "vitest";
import { autoAllocate } from "@/lib/allocation";

const open = [
  { invoiceId: "a", outstanding: "1000.00" },
  { invoiceId: "b", outstanding: "500.00" },
];

describe("autoAllocate", () => {
  it("fills invoices in the order given until the money runs out", () => {
    expect(autoAllocate("1200.00", open)).toEqual({
      allocations: [
        { invoiceId: "a", amount: "1000.00" },
        { invoiceId: "b", amount: "200.00" },
      ],
      unapplied: "0.00",
    });
  });

  it("leaves the excess unapplied", () => {
    expect(autoAllocate("2000", open).unapplied).toBe("500.00");
  });

  it("allocates nothing for zero or invalid amounts", () => {
    expect(autoAllocate("0", open)).toEqual({ allocations: [], unapplied: "0.00" });
    expect(autoAllocate("abc", open)).toEqual({ allocations: [], unapplied: "0.00" });
  });
});
