import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { parts } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";
import {
  createPart,
  getPart,
  searchParts,
  updatePart,
  upsertCategory,
  upsertVehicleModel,
  type PartInput,
} from "@/server/services/catalog";
import { resetDb } from "../helpers/db";
import { makePart, makeUser, tierIds } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;

async function partInput(overrides: Partial<PartInput> = {}): Promise<PartInput> {
  const tiers = await tierIds();
  return {
    sku: "BRK-001",
    name: "Brake Shoe Pulsar 150",
    unit: "pcs",
    reorderLevel: 5,
    reorderQty: 10,
    isActive: true,
    prices: [
      { tierId: tiers.Retail, price: "1000.00" },
      { tierId: tiers.Dealer, price: "900.00" },
    ],
    fitmentIds: [],
    ...overrides,
  };
}

describe("catalog", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("only lets an admin create parts", async () => {
    await expect(createPart(staff, await partInput())).rejects.toBeInstanceOf(Forbidden);
  });

  it("creates a part with prices and fitments, starting at qty 0 and avg cost 0", async () => {
    const pulsar = await upsertVehicleModel(admin, { make: "Bajaj", model: "Pulsar 150" });
    const { id } = await createPart(admin, await partInput({ fitmentIds: [pulsar.id] }));
    const detail = await getPart(admin, id);
    expect(detail.qtyOnHand).toBe(0);
    expect(detail.avgCost).toBe("0.00");
    expect(detail.prices.map((p) => p.price).sort()).toEqual(["1000.00", "900.00"]);
    expect(detail.fitments.map((f) => f.vehicleModelId)).toEqual([pulsar.id]);
  });

  it("finds a part by its OEM number", async () => {
    await makePart({ sku: "X-1", name: "Clutch Plate", oemPartNo: "HON-123" });
    await makePart({ sku: "X-2", name: "Chain Kit", oemPartNo: "YAM-999" });
    const rows = await searchParts("HON-123");
    expect(rows.map((r) => r.sku)).toEqual(["X-1"]);
  });

  it("finds a part by a word in its name", async () => {
    await makePart({ sku: "BRK-001", name: "Brake Shoe Pulsar 150" });
    await makePart({ sku: "CHN-001", name: "Chain Kit" });
    const rows = await searchParts("brake");
    expect(rows.map((r) => r.name)).toEqual(["Brake Shoe Pulsar 150"]);
  });

  it("ranks an exact SKU match first", async () => {
    await makePart({ sku: "OIL-10", name: "Oil Filter Large" });
    await makePart({ sku: "OIL-1", name: "Oil Filter" });
    const rows = await searchParts("oil-1");
    expect(rows[0].sku).toBe("OIL-1");
  });

  it("filters by vehicle model with an empty query", async () => {
    const pulsar = await upsertVehicleModel(admin, { make: "Bajaj", model: "Pulsar 150" });
    await makePart({ sku: "FIT-1", fitmentIds: [pulsar.id] });
    await makePart({ sku: "NOFIT-1" });
    const rows = await searchParts("", { vehicleModelId: pulsar.id });
    expect(rows.map((r) => r.sku)).toEqual(["FIT-1"]);
  });

  it("finds a part by one of its keywords (other names, supplier numbers)", async () => {
    await makePart({ sku: "PAD-1", name: "Disc Brake Pad Front", keywords: "pad set, LMP-4471" });
    await makePart({ sku: "CHN-1", name: "Chain Kit" });
    expect((await searchParts("lmp-4471")).map((r) => r.sku)).toEqual(["PAD-1"]);
    expect((await searchParts("pad set")).map((r) => r.sku)).toEqual(["PAD-1"]);
  });

  it("saves and returns keywords on a part", async () => {
    const { id } = await createPart(admin, await partInput({ keywords: "  shoe, brake liner  " }));
    expect((await getPart(admin, id)).keywords).toBe("shoe, brake liner");
  });

  it("browses a category with an empty query", async () => {
    const brakes = await upsertCategory(admin, { name: "Brakes" });
    await makePart({ sku: "B-2", categoryId: brakes.id });
    await makePart({ sku: "B-1", categoryId: brakes.id });
    await makePart({ sku: "E-1" });
    const rows = await searchParts("", { categoryId: brakes.id });
    expect(rows.map((r) => r.sku)).toEqual(["B-1", "B-2"]);
  });

  it("treats % and _ in the query literally", async () => {
    await makePart({ sku: "BRK-001", name: "Brake Shoe Pulsar 150" });
    await makePart({ sku: "CHN_1", name: "Chain Kit" });
    await expect(searchParts("50%")).resolves.toEqual([]);
    const underscore = await searchParts("CHN_");
    expect(underscore.map((r) => r.sku)).toEqual(["CHN_1"]);
  });

  it("never includes cost in search rows", async () => {
    await makePart({ sku: "C-1", avgCost: "123.45", qty: 2 });
    const [row] = await searchParts("C-1");
    expect(row).not.toHaveProperty("avgCost");
    expect(row.qtyOnHand).toBe(2);
  });

  it("hides avg cost and movement cost from staff", async () => {
    const { id } = await makePart({ qty: 3, avgCost: "50.00" });
    const forStaff = await getPart(staff, id);
    expect(forStaff).not.toHaveProperty("avgCost");
    expect(forStaff.movements[0]).not.toHaveProperty("unitCost");
    const forAdmin = await getPart(admin, id);
    expect(forAdmin.avgCost).toBe("50.00");
    expect(forAdmin.movements[0].unitCost).toBe("50.00");
  });

  it("updatePart ignores qty and avg cost", async () => {
    const { id, sku } = await makePart({ qty: 5, avgCost: "100.00" });
    const input = { ...(await partInput({ sku, name: "Renamed" })), qtyOnHand: 99, avgCost: "1.00" };
    await updatePart(admin, id, input as PartInput);
    const [row] = await db.select().from(parts).where(eq(parts.id, id));
    expect(row.name).toBe("Renamed");
    expect(row.qtyOnHand).toBe(5);
    expect(row.avgCost).toBe("100.00");
  });

  it("only lets an admin edit categories", async () => {
    await expect(upsertCategory(staff, { name: "Brakes" })).rejects.toBeInstanceOf(Forbidden);
    await expect(upsertCategory(admin, { name: "Brakes" })).resolves.toHaveProperty("id");
  });
});
