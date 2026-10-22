import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { colomboYear } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { parts, stockMovements } from "@/server/db/schema";
import { InvalidState, NotFound } from "@/server/errors";
import { createGrn, getGrn, lastSupplierForParts } from "@/server/services/grn";
import { resetDb } from "../helpers/db";
import { makePart, makeSupplier, makeUser } from "../helpers/factories";

const year = colomboYear();
let staff: SessionUser;

describe("GRN", () => {
  beforeEach(async () => {
    await resetDb();
    staff = await makeUser("staff");
  });

  it("receives stock, sets average cost and numbers the GRN", async () => {
    const supplier = await makeSupplier();
    const { id: partId } = await makePart();
    const grn = await createGrn(staff, {
      supplierId: supplier.id,
      lines: [{ partId, qty: 10, unitCost: "100.00" }],
    });
    expect(grn.number).toBe(`GRN-${year}-000001`);
    const [part] = await db.select().from(parts).where(eq(parts.id, partId));
    expect(part.qtyOnHand).toBe(10);
    expect(part.avgCost).toBe("100.00");
    const ms = await db.select().from(stockMovements).where(eq(stockMovements.partId, partId));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ type: "GRN", qtyChange: 10, refType: "grn", refId: grn.id });
  });

  it("averages cost across GRNs", async () => {
    const supplier = await makeSupplier();
    const { id: partId } = await makePart();
    await createGrn(staff, { supplierId: supplier.id, lines: [{ partId, qty: 10, unitCost: "100.00" }] });
    await createGrn(staff, { supplierId: supplier.id, lines: [{ partId, qty: 10, unitCost: "120.00" }] });
    const [part] = await db.select().from(parts).where(eq(parts.id, partId));
    expect(part.avgCost).toBe("110.00");
    expect(part.qtyOnHand).toBe(20);
  });

  it("stores the total and lets staff see the GRN's unit cost", async () => {
    const supplier = await makeSupplier();
    const a = await makePart();
    const b = await makePart();
    const { id } = await createGrn(staff, {
      supplierId: supplier.id,
      lines: [
        { partId: a.id, qty: 3, unitCost: "33.33" },
        { partId: b.id, qty: 2, unitCost: "10.50" },
      ],
    });
    const grn = await getGrn(staff, id);
    expect(grn.total).toBe("120.99");
    expect(grn.items[0].unitCost).toBe("33.33");
  });

  it("rolls back on a missing part without consuming a number", async () => {
    const supplier = await makeSupplier();
    const { id: partId } = await makePart();
    await expect(
      createGrn(staff, {
        supplierId: supplier.id,
        lines: [
          { partId, qty: 1, unitCost: "5.00" },
          { partId: randomUUID(), qty: 1, unitCost: "5.00" },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFound);
    const [part] = await db.select().from(parts).where(eq(parts.id, partId));
    expect(part.qtyOnHand).toBe(0);
    const next = await createGrn(staff, { supplierId: supplier.id, lines: [{ partId, qty: 1, unitCost: "5.00" }] });
    expect(next.number).toBe(`GRN-${year}-000001`);
  });

  it("refuses an inactive supplier", async () => {
    const supplier = await makeSupplier({ isActive: false });
    const { id: partId } = await makePart();
    await expect(
      createGrn(staff, { supplierId: supplier.id, lines: [{ partId, qty: 1, unitCost: "5.00" }] }),
    ).rejects.toBeInstanceOf(InvalidState);
  });

  it("reports the supplier of each part's most recent GRN", async () => {
    const first = await makeSupplier({ name: "First Motors" });
    const second = await makeSupplier({ name: "Second Traders" });
    const { id: partId } = await makePart();
    const other = await makePart();
    await createGrn(staff, { supplierId: first.id, lines: [{ partId, qty: 1, unitCost: "5.00" }] });
    await createGrn(staff, { supplierId: second.id, lines: [{ partId, qty: 1, unitCost: "5.00" }] });
    const map = await lastSupplierForParts([partId, other.id]);
    expect(map.get(partId)).toEqual({ supplierId: second.id, supplierName: "Second Traders" });
    expect(map.has(other.id)).toBe(false);
  });
});
