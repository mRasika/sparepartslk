import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { partPrices, priceTiers } from "@/server/db/schema";
import { DomainError, Forbidden } from "@/server/errors";
import { upsertBrand, upsertCategory } from "@/server/services/catalog";
import {
  applyBulkPriceChange,
  createTier,
  listTiersWithStats,
  previewBulkPriceChange,
  updateTier,
} from "@/server/services/tiers";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser, tierIds } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;

async function price(partId: string, tierId: string) {
  const [row] = await db
    .select({ price: partPrices.price })
    .from(partPrices)
    .where(and(eq(partPrices.partId, partId), eq(partPrices.tierId, tierId)));
  return row?.price;
}

describe("price tiers", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("only lets an admin add or change tiers", async () => {
    await expect(createTier(staff, { name: "Fleet", discountPct: "5", roundTo: 0 })).rejects.toBeInstanceOf(Forbidden);
    const tiers = await tierIds();
    await expect(updateTier(staff, tiers.Dealer, { name: "Dealer", discountPct: "5", roundTo: 0 })).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it("adds a tier with a rule and refuses a duplicate name", async () => {
    const { id } = await createTier(admin, { name: " Fleet ", discountPct: "7.5", roundTo: 5 });
    const [row] = await db.select().from(priceTiers).where(eq(priceTiers.id, id));
    expect(row).toMatchObject({ name: "Fleet", discountPct: "7.50", roundTo: 5, isDefault: false });
    const dup = await createTier(admin, { name: "fleet", discountPct: "0", roundTo: 0 }).catch((e) => e);
    expect(dup).toBeInstanceOf(DomainError);
    expect(dup.code).toBe("Duplicate");
  });

  it("renames and re-rules a tier, but the default tier never gets a rule", async () => {
    const tiers = await tierIds();
    await updateTier(admin, tiers.Dealer, { name: "Trade", discountPct: "10", roundTo: 10 });
    await updateTier(admin, tiers.Retail, { name: "Retail", discountPct: "20", roundTo: 50 });
    const rows = await db.select().from(priceTiers);
    expect(rows.find((r) => r.id === tiers.Dealer)).toMatchObject({ name: "Trade", discountPct: "10.00", roundTo: 10 });
    expect(rows.find((r) => r.id === tiers.Retail)).toMatchObject({ discountPct: "0.00", roundTo: 0 });
  });

  it("rejects rules out of range", async () => {
    const tiers = await tierIds();
    await expect(updateTier(admin, tiers.Dealer, { name: "Dealer", discountPct: "100", roundTo: 0 })).rejects.toThrow();
    await expect(updateTier(admin, tiers.Dealer, { name: "Dealer", discountPct: "5", roundTo: 7 })).rejects.toThrow();
  });

  it("lists tiers with customer, typed-price and below-cost counts", async () => {
    const tiers = await tierIds();
    await makeCustomer({ tier: "Dealer" });
    await makeCustomer({ tier: "Dealer" });
    // Typed Dealer price 900, cost 950: below cost.
    await makePart({ avgCost: "950.00" });
    // No Dealer price; rule −20% of 1000 = 800 vs cost 850: below cost once the rule is set.
    await makePart({ avgCost: "850.00", prices: [{ tierId: tiers.Retail, price: "1000.00" }] });
    await updateTier(admin, tiers.Dealer, { name: "Dealer", discountPct: "20", roundTo: 0 });

    const rows = await listTiersWithStats();
    expect(rows.map((r) => r.name)).toEqual(["Retail", "Dealer", "Wholesale"]);
    expect(rows.find((r) => r.name === "Dealer")).toMatchObject({
      discountPct: "20.00",
      customerCount: 2,
      typedPriceCount: 1,
      belowCostCount: 2,
    });
    expect(rows.find((r) => r.name === "Retail")).toMatchObject({ belowCostCount: 0, typedPriceCount: 2 });
  });
});

describe("bulk price change", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("previews and applies a % change to one tier's typed prices, filtered and rounded", async () => {
    const tiers = await tierIds();
    const bajaj = await upsertBrand(admin, { name: "Bajaj" });
    const brakes = await upsertCategory(admin, { name: "Brakes" });
    const hit = await makePart({ sku: "B-1", brandId: bajaj.id, categoryId: brakes.id, avgCost: "1100.00" });
    const otherCategory = await makePart({ sku: "B-2", brandId: bajaj.id });
    const otherBrand = await makePart({ sku: "B-3", categoryId: brakes.id });
    const input = { tierId: tiers.Retail, brandId: bajaj.id, categoryId: brakes.id, changePct: "7", roundTo: 10 };

    const preview = await previewBulkPriceChange(admin, input);
    expect(preview.count).toBe(1);
    expect(preview.rows).toEqual([
      expect.objectContaining({ partId: hit.id, sku: "B-1", oldPrice: "1000.00", newPrice: "1070.00", belowCost: true }),
    ]);
    expect(preview.belowCostCount).toBe(1);
    expect(await price(hit.id, tiers.Retail)).toBe("1000.00"); // preview writes nothing

    expect(await applyBulkPriceChange(admin, input)).toEqual({ updated: 1 });
    expect(await price(hit.id, tiers.Retail)).toBe("1070.00");
    expect(await price(hit.id, tiers.Dealer)).toBe("900.00");
    expect(await price(otherCategory.id, tiers.Retail)).toBe("1000.00");
    expect(await price(otherBrand.id, tiers.Retail)).toBe("1000.00");
  });

  it("lowers prices and leaves parts on the tier rule alone", async () => {
    const tiers = await tierIds();
    const typed = await makePart();
    const ruled = await makePart({ prices: [{ tierId: tiers.Retail, price: "1000.00" }] });
    await applyBulkPriceChange(admin, { tierId: tiers.Dealer, changePct: "-5", roundTo: 0 });
    expect(await price(typed.id, tiers.Dealer)).toBe("855.00");
    expect(await price(ruled.id, tiers.Dealer)).toBeUndefined();
  });

  it("is admin only and refuses a zero or extreme change", async () => {
    const tiers = await tierIds();
    await expect(previewBulkPriceChange(staff, { tierId: tiers.Retail, changePct: "5", roundTo: 0 })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(applyBulkPriceChange(admin, { tierId: tiers.Retail, changePct: "0", roundTo: 0 })).rejects.toThrow();
    await expect(applyBulkPriceChange(admin, { tierId: tiers.Retail, changePct: "-95", roundTo: 0 })).rejects.toThrow();
  });
});
