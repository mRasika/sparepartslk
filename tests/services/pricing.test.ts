import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { DiscountNotAllowed, PriceMissing } from "@/server/errors";
import { assertDiscountAllowed, computeTotals, resolvePrices } from "@/server/services/pricing";
import { resetDb } from "../helpers/db";
import { makePart, makeUser, tierIds } from "../helpers/factories";

describe("resolvePrices", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("uses the customer's tier price", async () => {
    const tiers = await tierIds();
    const { id } = await makePart();
    const prices = await resolvePrices(db, tiers.Dealer, [id]);
    expect(prices.get(id)).toBe("900.00");
  });

  it("falls back to the default tier when the tier has no price", async () => {
    const tiers = await tierIds();
    const { id } = await makePart({ prices: [{ tierId: tiers.Retail, price: "1000.00" }] });
    const prices = await resolvePrices(db, tiers.Dealer, [id]);
    expect(prices.get(id)).toBe("1000.00");
  });

  it("raises PriceMissing instead of pricing at zero", async () => {
    const tiers = await tierIds();
    const { id } = await makePart({ sku: "NOPRICE-1", prices: [] });
    const err = await resolvePrices(db, tiers.Dealer, [id]).catch((e) => e);
    expect(err).toBeInstanceOf(PriceMissing);
    expect(err.details).toMatchObject({ partId: id, sku: "NOPRICE-1" });
  });
});

describe("computeTotals", () => {
  const line = { partId: "p", qty: 3, unitPrice: "33.33" };

  it("rounds each step half-up and adds up exactly", () => {
    const t = computeTotals([{ ...line, discount: { type: "percent", value: "10" } }], undefined, "18");
    expect(t.lines[0]).toEqual({ gross: "99.99", discount: "10.00", lineTotal: "89.99" });
    expect(t.subtotal).toBe("89.99");
    expect(t.vatAmount).toBe("16.20");
    expect(t.total).toBe("106.19");
  });

  it("charges no VAT at rate 0", () => {
    const t = computeTotals([line], undefined, "0");
    expect(t.vatAmount).toBe("0.00");
    expect(t.total).toBe("99.99");
  });

  it("applies an invoice discount on the subtotal", () => {
    const t = computeTotals(
      [{ partId: "p", qty: 1, unitPrice: "1000.00" }],
      { type: "percent", value: "5" },
      "0",
    );
    expect(t.invoiceDiscount).toBe("50.00");
    expect(t.total).toBe("950.00");
  });

  it("takes VAT after the invoice discount", () => {
    const t = computeTotals(
      [{ partId: "p", qty: 2, unitPrice: "500.00" }],
      { type: "amount", value: "100" },
      "18",
    );
    expect(t.vatAmount).toBe("162.00");
    expect(t.total).toBe("1062.00");
  });

  it("rejects a discount bigger than the line", () => {
    expect(() =>
      computeTotals([{ ...line, discount: { type: "amount", value: "100.00" } }], undefined, "0"),
    ).toThrow(DiscountNotAllowed);
  });
});

describe("assertDiscountAllowed", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const withLineDiscount = (pct: string) =>
    computeTotals(
      [{ partId: "p", qty: 1, unitPrice: "1000.00", discount: { type: "percent", value: pct } }],
      undefined,
      "0",
    );

  it("caps staff discounts", async () => {
    const staff = await makeUser("staff");
    expect(() => assertDiscountAllowed(staff, withLineDiscount("11"), "10")).toThrow(DiscountNotAllowed);
    expect(() => assertDiscountAllowed(staff, withLineDiscount("10"), "10")).not.toThrow();
  });

  it("caps the staff invoice discount too", async () => {
    const staff = await makeUser("staff");
    const t = computeTotals(
      [{ partId: "p", qty: 1, unitPrice: "1000.00" }],
      { type: "amount", value: "150" },
      "0",
    );
    expect(() => assertDiscountAllowed(staff, t, "10")).toThrow(DiscountNotAllowed);
  });

  it("lets admins give any discount", async () => {
    const admin = await makeUser("admin");
    expect(() => assertDiscountAllowed(admin, withLineDiscount("50"), "10")).not.toThrow();
  });
});
