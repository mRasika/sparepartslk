import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { settings } from "@/server/db/schema";
import { nextNumber } from "@/server/services/sequences";
import { resetDb } from "../helpers/db";

const IN_2026 = new Date("2026-06-15T06:00:00Z");

describe("nextNumber", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("issues sequential numbers per type and year", async () => {
    const first = await db.transaction((tx) => nextNumber(tx, "INV", IN_2026));
    const second = await db.transaction((tx) => nextNumber(tx, "INV", IN_2026));
    const grn = await db.transaction((tx) => nextNumber(tx, "GRN", IN_2026));
    expect(first).toBe("INV-2026-000001");
    expect(second).toBe("INV-2026-000002");
    expect(grn).toBe("GRN-2026-000001");
  });

  it("starts a new year from the Colombo-local date", async () => {
    await db.transaction((tx) => nextNumber(tx, "INV", IN_2026));
    const n = await db.transaction((tx) =>
      nextNumber(tx, "INV", new Date("2026-12-31T19:00:00Z")),
    );
    expect(n).toBe("INV-2027-000001");
  });

  it("prepends doc_prefix when set", async () => {
    await db.update(settings).set({ docPrefix: "SP" });
    const n = await db.transaction((tx) => nextNumber(tx, "INV", IN_2026));
    expect(n).toBe("SP-INV-2026-000001");
  });

  it("reuses a number whose transaction rolled back (no gaps)", async () => {
    await expect(
      db.transaction(async (tx) => {
        await nextNumber(tx, "PAY", IN_2026);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const n = await db.transaction((tx) => nextNumber(tx, "PAY", IN_2026));
    expect(n).toBe("PAY-2026-000001");
  });

  it("gives 20 parallel callers 20 distinct numbers 1..20", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => db.transaction((tx) => nextNumber(tx, "GRN", IN_2026))),
    );
    const seq = numbers.map((n) => Number(n.slice(-6))).sort((a, b) => a - b);
    expect(seq).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const [row] = await db.execute<{ next_no: number }>(
      sql`select next_no from document_sequences where doc_type = 'GRN' and year = 2026`,
    );
    expect(row.next_no).toBe(20);
  });
});
