import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { customers, parts, priceTiers, settings } from "@/server/db/schema";
import { pgErrorCode, resetDb } from "../helpers/db";

async function insertPart(sku: string, qty = 0) {
  const [row] = await db
    .insert(parts)
    .values({ sku, name: `Part ${sku}`, qtyOnHand: qty })
    .returning({ id: parts.id });
  return row.id;
}

describe("schema", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects negative qty_on_hand", async () => {
    const id = await insertPart("NEG-1");
    const code = await pgErrorCode(
      db.update(parts).set({ qtyOnHand: -1 }).where(eq(parts.id, id)),
    );
    expect(code).toBe("23514");
  });

  it("enforces unique sku", async () => {
    await insertPart("DUP-1");
    const code = await pgErrorCode(insertPart("DUP-1"));
    expect(code).toBe("23505");
  });

  it("resetDb seeds defaults", async () => {
    const tiers = await db.select().from(priceTiers);
    expect(tiers).toHaveLength(3);
    const defaults = tiers.filter((t) => t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe("Retail");

    const walkIn = await db
      .select()
      .from(customers)
      .where(eq(customers.isWalkIn, true));
    expect(walkIn).toHaveLength(1);
    expect(walkIn[0].name).toBe("Walk-in Customer");

    const [s] = await db.select().from(settings);
    expect(s.vatRate).toBe("18.00");
  });

  it("reconcile_stock flags drift", async () => {
    await insertPart("DRIFT-1", 5);
    const first = await db.execute<{ n: number }>(
      sql`select public.reconcile_stock() as n`,
    );
    expect(first[0].n).toBe(1);
    const second = await db.execute<{ n: number }>(
      sql`select public.reconcile_stock() as n`,
    );
    expect(second[0].n).toBe(0);
  });
});
