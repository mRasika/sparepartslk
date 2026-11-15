import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { clampLabelCount } from "@/lib/labels";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { grnItems, grns, parts } from "@/server/db/schema";
import { NotFound } from "@/server/errors";

/** A part to print SKU labels for, with how many labels to offer by default. */
export type LabelPart = {
  partId: string;
  sku: string;
  name: string;
  binLocation: string | null;
  hasBarcode: boolean;
  defaultCount: number;
};

/**
 * Parts for the label page: one part (one label), or every part on a GRN, one row per part in
 * line order, offering a label per unit received. Parts with a factory barcode already scan, so
 * they default to no labels. Both roles may print labels.
 */
export async function getLabelParts(
  _user: SessionUser,
  source: { partId: string } | { grnId: string },
): Promise<LabelPart[]> {
  if ("partId" in source) {
    if (!z.uuid().safeParse(source.partId).success) throw new NotFound("Part not found");
    const [part] = await db
      .select({ partId: parts.id, sku: parts.sku, name: parts.name, binLocation: parts.binLocation, barcode: parts.barcode })
      .from(parts)
      .where(eq(parts.id, source.partId));
    if (!part) throw new NotFound("Part not found");
    const { barcode, ...rest } = part;
    return [{ ...rest, hasBarcode: Boolean(barcode), defaultCount: 1 }];
  }

  if (!z.uuid().safeParse(source.grnId).success) throw new NotFound("GRN not found");
  const [grn] = await db.select({ id: grns.id }).from(grns).where(eq(grns.id, source.grnId));
  if (!grn) throw new NotFound("GRN not found");

  const rows = await db
    .select({
      partId: parts.id,
      sku: parts.sku,
      name: parts.name,
      binLocation: parts.binLocation,
      barcode: parts.barcode,
      qty: sql<number>`sum(${grnItems.qty})::int`,
    })
    .from(grnItems)
    .innerJoin(parts, eq(parts.id, grnItems.partId))
    .where(eq(grnItems.grnId, source.grnId))
    .groupBy(parts.id)
    .orderBy(asc(sql`min(${grnItems.lineNo})`));

  return rows.map(({ barcode, qty, ...rest }) => ({
    ...rest,
    hasBarcode: Boolean(barcode),
    defaultCount: barcode ? 0 : clampLabelCount(qty),
  }));
}
