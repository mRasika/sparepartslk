import { beforeEach, describe, expect, it } from "vitest";
import { createGrn } from "@/server/services/grn";
import { lowStock, lowStockCount, stockList } from "@/server/services/inventory";
import { resetDb } from "../helpers/db";
import { makePart, makeSupplier, makeUser } from "../helpers/factories";

describe("low stock", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("suggests twice the level minus on-hand when no reorder qty is set", async () => {
    await makePart({ sku: "A", qty: 3, reorderLevel: 5, reorderQty: 0 });
    const [row] = await lowStock();
    expect(row).toMatchObject({ sku: "A", qtyOnHand: 3, suggestedQty: 7 });
  });

  it("suggests the reorder qty when set", async () => {
    await makePart({ sku: "B", qty: 0, reorderLevel: 2, reorderQty: 12 });
    const [row] = await lowStock();
    expect(row.suggestedQty).toBe(12);
  });

  it("includes on-hand equal to the level and excludes level 0 and inactive parts", async () => {
    await makePart({ sku: "EQUAL", qty: 5, reorderLevel: 5 });
    await makePart({ sku: "NOLEVEL", qty: 0, reorderLevel: 0 });
    await makePart({ sku: "INACTIVE", qty: 0, reorderLevel: 5, isActive: false });
    await makePart({ sku: "PLENTY", qty: 9, reorderLevel: 5 });
    const rows = await lowStock();
    expect(rows.map((r) => r.sku)).toEqual(["EQUAL"]);
    expect(await lowStockCount()).toBe(rows.length);
  });

  it("shows the last supplier and sorts by supplier then SKU", async () => {
    const staff = await makeUser("staff");
    const zeta = await makeSupplier({ name: "Zeta Imports" });
    const alpha = await makeSupplier({ name: "Alpha Motors" });
    const p1 = await makePart({ sku: "P1", reorderLevel: 5 });
    const p2 = await makePart({ sku: "P2", reorderLevel: 5 });
    const p3 = await makePart({ sku: "P0", reorderLevel: 5 });
    await createGrn(staff, { supplierId: zeta.id, lines: [{ partId: p1.id, qty: 1, unitCost: "1.00" }] });
    await createGrn(staff, { supplierId: alpha.id, lines: [{ partId: p2.id, qty: 1, unitCost: "1.00" }] });
    const rows = await lowStock();
    expect(rows.map((r) => [r.sku, r.lastSupplierName ?? null])).toEqual([
      ["P2", "Alpha Motors"],
      ["P1", "Zeta Imports"],
      ["P0", null],
    ]);
    expect(p3).toBeDefined();
  });

  it("gives admins stock value and hides cost from staff", async () => {
    const admin = await makeUser("admin");
    const staff = await makeUser("staff");
    await makePart({ sku: "V", qty: 4, avgCost: "12.50" });
    const [forAdmin] = await stockList(admin, {});
    expect(forAdmin.avgCost).toBe("12.50");
    expect(forAdmin.stockValue).toBe("50.00");
    const [forStaff] = await stockList(staff, {});
    expect(forStaff).not.toHaveProperty("avgCost");
    expect(forStaff).not.toHaveProperty("stockValue");
  });

  it("matches % and _ literally in the stock search", async () => {
    const admin = await makeUser("admin");
    await makePart({ sku: "PCT-1", name: "Oil 10% blend" });
    await makePart({ sku: "PCT-2", name: "Oil 100 blend" });
    const rows = await stockList(admin, { q: "10%" });
    expect(rows.map((r) => r.sku)).toEqual(["PCT-1"]);
  });
});
