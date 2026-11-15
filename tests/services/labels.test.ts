import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { createGrn } from "@/server/services/grn";
import { getLabelParts } from "@/server/services/labels";
import { resetDb } from "../helpers/db";
import { makePart, makeSupplier, makeUser } from "../helpers/factories";

let staff: SessionUser;
let supplierId: string;

describe("getLabelParts", () => {
  beforeEach(async () => {
    await resetDb();
    staff = await makeUser("staff");
    supplierId = (await makeSupplier()).id;
  });

  it("GRN: received qty for parts without a barcode, 0 for parts with one", async () => {
    const a = await makePart({ sku: "A-1", binLocation: "R1" });
    const b = await makePart({ sku: "B-1", barcode: "8901" });
    const grn = await createGrn(staff, {
      supplierId,
      lines: [
        { partId: a.id, qty: 5, unitCost: "10" },
        { partId: b.id, qty: 3, unitCost: "10" },
      ],
    });
    expect(await getLabelParts(staff, { grnId: grn.id })).toMatchObject([
      { partId: a.id, sku: "A-1", binLocation: "R1", hasBarcode: false, defaultCount: 5 },
      { partId: b.id, sku: "B-1", hasBarcode: true, defaultCount: 0 },
    ]);
  });

  it("GRN: the same part on two lines gives one row with the summed qty", async () => {
    const a = await makePart({ sku: "A-1" });
    const b = await makePart({ sku: "B-1" });
    const grn = await createGrn(staff, {
      supplierId,
      lines: [
        { partId: a.id, qty: 2, unitCost: "10" },
        { partId: b.id, qty: 1, unitCost: "10" },
        { partId: a.id, qty: 4, unitCost: "12" },
      ],
    });
    const rows = await getLabelParts(staff, { grnId: grn.id });
    expect(rows.map((r) => [r.sku, r.defaultCount])).toEqual([
      ["A-1", 6],
      ["B-1", 1],
    ]);
  });

  it("GRN: a received qty above 999 defaults to 999", async () => {
    const a = await makePart({ sku: "BOLT-1" });
    const grn = await createGrn(staff, { supplierId, lines: [{ partId: a.id, qty: 1500, unitCost: "1" }] });
    expect((await getLabelParts(staff, { grnId: grn.id }))[0].defaultCount).toBe(999);
  });

  it("part: one row, default 1", async () => {
    const a = await makePart({ sku: "A-1", barcode: "8901" });
    expect(await getLabelParts(staff, { partId: a.id })).toMatchObject([
      { partId: a.id, sku: "A-1", hasBarcode: true, defaultCount: 1 },
    ]);
  });

  it("unknown or malformed ids are NotFound", async () => {
    await expect(getLabelParts(staff, { partId: "nope" })).rejects.toBeInstanceOf(NotFound);
    await expect(getLabelParts(staff, { partId: randomUUID() })).rejects.toBeInstanceOf(NotFound);
    await expect(getLabelParts(staff, { grnId: "nope" })).rejects.toBeInstanceOf(NotFound);
    await expect(getLabelParts(staff, { grnId: randomUUID() })).rejects.toBeInstanceOf(NotFound);
  });
});
