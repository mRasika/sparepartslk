import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import {
  closedDays,
  customers,
  parts,
  priceTiers,
  quotationItems,
  quotations,
  salesTargets,
  settings,
} from "@/server/db/schema";
import { pgErrorCode, resetDb } from "../helpers/db";
import { factoryAdmin, makePart, tierIds } from "../helpers/factories";

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

describe("quotations", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function insertQuotation(overrides: Partial<typeof quotations.$inferInsert> = {}) {
    const admin = await factoryAdmin();
    const [walkIn] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
    const tiers = await tierIds();
    const [row] = await db
      .insert(quotations)
      .values({
        number: `QUO-2026-${Math.random().toString().slice(2, 8)}`,
        customerId: walkIn.id,
        quotationDate: "2026-06-15",
        validUntil: "2026-06-29",
        paymentType: "cash",
        tierId: tiers.Retail,
        vatRate: "18.00",
        subtotal: "0.00",
        discountTotal: "0.00",
        vatAmount: "0.00",
        total: "0.00",
        updatedBy: admin.id,
        createdBy: admin.id,
        ...overrides,
      })
      .returning();
    return row;
  }

  it("rejects a quotation item with qty 0", async () => {
    const q = await insertQuotation();
    const part = await makePart();
    const code = await pgErrorCode(
      db.insert(quotationItems).values({
        quotationId: q.id,
        lineNo: 1,
        partId: part.id,
        description: "Part",
        qty: 0,
        unitPrice: "10.00",
        discount: "0.00",
        lineTotal: "0.00",
      }),
    );
    expect(code).toBe("23514");
  });

  it("rejects valid_until before quotation_date", async () => {
    const code = await pgErrorCode(insertQuotation({ validUntil: "2026-06-14" }));
    expect(code).toBe("23514");
  });

  it("rejects converted without an invoice", async () => {
    const code = await pgErrorCode(insertQuotation({ status: "converted", invoiceId: null }));
    expect(code).toBe("23514");
  });

  it("rejects cancelled without a reason", async () => {
    const code = await pgErrorCode(insertQuotation({ status: "cancelled", cancelReason: null }));
    expect(code).toBe("23514");
  });

  it("deletes items with their quotation", async () => {
    const q = await insertQuotation();
    const part = await makePart();
    await db.insert(quotationItems).values({
      quotationId: q.id,
      lineNo: 1,
      partId: part.id,
      description: "Part",
      qty: 1,
      unitPrice: "10.00",
      discount: "0.00",
      lineTotal: "10.00",
    });
    await db.delete(quotations).where(eq(quotations.id, q.id));
    expect(await db.$count(quotationItems)).toBe(0);
  });
});

describe("sales targets", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function insertTarget(overrides: Partial<typeof salesTargets.$inferInsert> = {}) {
    const admin = await factoryAdmin();
    return db.insert(salesTargets).values({
      effectiveFrom: "2026-10-01",
      dailyTarget: "250000.00",
      closedWeekdays: [7],
      createdBy: admin.id,
      ...overrides,
    });
  }

  it("rejects a zero target", async () => {
    expect(await pgErrorCode(insertTarget({ dailyTarget: "0.00" }))).toBe("23514");
  });

  it("rejects all seven weekdays closed", async () => {
    expect(await pgErrorCode(insertTarget({ closedWeekdays: [1, 2, 3, 4, 5, 6, 7] }))).toBe("23514");
  });

  it("rejects weekday 8", async () => {
    expect(await pgErrorCode(insertTarget({ closedWeekdays: [8] }))).toBe("23514");
  });

  it("allows one target per day", async () => {
    await insertTarget();
    expect(await pgErrorCode(insertTarget({ dailyTarget: "300000.00" }))).toBe("23505");
  });

  it("allows one closed row per date", async () => {
    const admin = await factoryAdmin();
    const close = () => db.insert(closedDays).values({ day: "2026-10-30", reason: "Poya", createdBy: admin.id });
    await close();
    expect(await pgErrorCode(close())).toBe("23505");
  });
});
