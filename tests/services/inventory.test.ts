import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { parts, stockMovements } from "@/server/db/schema";
import { InsufficientStock, NotFound } from "@/server/errors";
import { applyMovement, lockParts, recalcAvgCost } from "@/server/services/inventory";
import { resetDb } from "../helpers/db";
import { factoryAdmin, makePart } from "../helpers/factories";

async function movementsFor(partId: string) {
  return db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.partId, partId))
    .orderBy(stockMovements.createdAt);
}

async function qtyOf(partId: string) {
  const [row] = await db.select().from(parts).where(eq(parts.id, partId));
  return row;
}

describe("recalcAvgCost", () => {
  it("uses the incoming cost when there was no stock", () => {
    expect(recalcAvgCost(0, "0.00", 10, "100.00")).toBe("100.00");
  });

  it("weights old and new stock", () => {
    expect(recalcAvgCost(10, "100.00", 10, "120.00")).toBe("110.00");
  });

  it("rounds half-up to 2 decimals", () => {
    expect(recalcAvgCost(3, "33.33", 1, "50.00")).toBe("37.50");
  });
});

describe("inventory", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    userId = (await factoryAdmin()).id;
  });

  const move = (qtyChange: number, unitCost = "0.00", affectsAvgCost = false) => ({
    type: "ADJUST" as const,
    qtyChange,
    unitCost,
    refType: "test",
    refId: "00000000-0000-0000-0000-000000000001",
    userId,
    affectsAvgCost,
  });

  it("rejects a movement that would make stock negative and writes nothing", async () => {
    const { id } = await makePart({ qty: 5, avgCost: "10.00" });
    const err = await db
      .transaction(async (tx) => {
        const locked = await lockParts(tx, [id]);
        await applyMovement(tx, locked.get(id)!, move(-6));
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientStock);
    expect(err.details.available).toBe(5);
    expect(err.details.requested).toBe(6);
    expect((await qtyOf(id)).qtyOnHand).toBe(5);
    expect(await movementsFor(id)).toHaveLength(1);
  });

  it("adds stock and records balance_after", async () => {
    const { id } = await makePart({ qty: 5, avgCost: "10.00" });
    await db.transaction(async (tx) => {
      const locked = await lockParts(tx, [id]);
      await applyMovement(tx, locked.get(id)!, move(4, "10.00"));
    });
    expect((await qtyOf(id)).qtyOnHand).toBe(9);
    const ms = await movementsFor(id);
    expect(ms.at(-1)!.balanceAfter).toBe(9);
  });

  it("chains several movements on the same locked part", async () => {
    const { id } = await makePart({ qty: 5 });
    await db.transaction(async (tx) => {
      const locked = await lockParts(tx, [id]);
      let part = locked.get(id)!;
      part = await applyMovement(tx, part, move(-2));
      part = await applyMovement(tx, part, move(-2));
      expect(part.qtyOnHand).toBe(1);
    });
    expect((await qtyOf(id)).qtyOnHand).toBe(1);
    const balances = (await movementsFor(id)).slice(1).map((m) => m.balanceAfter);
    expect(balances).toEqual([3, 1]);
  });

  it("updates average cost on a costed receipt only", async () => {
    const { id } = await makePart({ qty: 10, avgCost: "100.00" });
    await db.transaction(async (tx) => {
      const locked = await lockParts(tx, [id]);
      let part = await applyMovement(tx, locked.get(id)!, move(10, "120.00", true));
      expect(part.avgCost).toBe("110.00");
      part = await applyMovement(tx, part, move(-5, "110.00", true));
      expect(part.avgCost).toBe("110.00");
    });
    expect((await qtyOf(id)).avgCost).toBe("110.00");
  });

  it("locks each id once even when repeated", async () => {
    const { id } = await makePart({ qty: 1 });
    await db.transaction(async (tx) => {
      const locked = await lockParts(tx, [id, id]);
      expect(locked.size).toBe(1);
    });
  });

  it("throws NotFound for an unknown part id", async () => {
    await expect(
      db.transaction((tx) => lockParts(tx, ["00000000-0000-0000-0000-000000000099"])),
    ).rejects.toBeInstanceOf(NotFound);
  });
});
