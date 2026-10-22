import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { colomboYear } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { parts, stockMovements } from "@/server/db/schema";
import { Forbidden, InsufficientStock } from "@/server/errors";
import { createAdjustment } from "@/server/services/adjustments";
import { resetDb } from "../helpers/db";
import { makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;

async function qty(partId: string) {
  const [row] = await db.select().from(parts).where(eq(parts.id, partId));
  return row.qtyOnHand;
}

describe("stock adjustments", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("forbids staff from count corrections", async () => {
    const { id } = await makePart({ qty: 3 });
    await expect(
      createAdjustment(staff, { reason: "count_correction", lines: [{ partId: id, qtyChange: 5 }] }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("forbids staff from increasing stock even for damage", async () => {
    const { id } = await makePart({ qty: 3 });
    await expect(
      createAdjustment(staff, { reason: "damage", lines: [{ partId: id, qtyChange: 1 }] }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("lets staff write off damaged stock", async () => {
    const { id } = await makePart({ qty: 5, avgCost: "40.00" });
    const adj = await createAdjustment(staff, { reason: "damage", lines: [{ partId: id, qtyChange: -2 }] });
    expect(adj.number).toBe(`ADJ-${colomboYear()}-000001`);
    expect(await qty(id)).toBe(3);
    const [m] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.refId, adj.id));
    expect(m).toMatchObject({ type: "ADJUST", qtyChange: -2, unitCost: "40.00", refType: "adjustment" });
  });

  it("rejects an adjustment below zero", async () => {
    const { id } = await makePart({ qty: 3 });
    await expect(
      createAdjustment(admin, { reason: "lost", lines: [{ partId: id, qtyChange: -10 }] }),
    ).rejects.toBeInstanceOf(InsufficientStock);
    expect(await qty(id)).toBe(3);
  });

  it("enters positive corrections at the current average cost", async () => {
    const { id } = await makePart({ qty: 4, avgCost: "25.00" });
    await createAdjustment(admin, { reason: "count_correction", lines: [{ partId: id, qtyChange: 2 }] });
    const [row] = await db.select().from(parts).where(eq(parts.id, id));
    expect(row.qtyOnHand).toBe(6);
    expect(row.avgCost).toBe("25.00");
  });

  it("rejects a zero change", async () => {
    const { id } = await makePart({ qty: 4 });
    await expect(
      createAdjustment(admin, { reason: "other", lines: [{ partId: id, qtyChange: 0 }] }),
    ).rejects.toThrow();
  });
});
