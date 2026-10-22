import { asc, eq, inArray } from "drizzle-orm";
import { D, fmt, round2 } from "@/lib/money";
import type { Tx } from "@/server/db/client";
import { parts, stockMovements } from "@/server/db/schema";
import { InsufficientStock, NotFound } from "@/server/errors";

export type LockedPart = {
  id: string;
  sku: string;
  name: string;
  qtyOnHand: number;
  avgCost: string;
  isActive: boolean;
};

export type MovementType = "GRN" | "SALE" | "SALE_CANCEL" | "RETURN" | "ADJUST";

/**
 * Locks the parts rows (`FOR UPDATE`, in id order so concurrent callers can't deadlock)
 * until the transaction ends. Throws NotFound if any id doesn't exist.
 */
export async function lockParts(tx: Tx, partIds: string[]): Promise<Map<string, LockedPart>> {
  const ids = [...new Set(partIds)].sort();
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: parts.id,
      sku: parts.sku,
      name: parts.name,
      qtyOnHand: parts.qtyOnHand,
      avgCost: parts.avgCost,
      isActive: parts.isActive,
    })
    .from(parts)
    .where(inArray(parts.id, ids))
    .orderBy(asc(parts.id))
    .for("update");
  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => r.id));
    throw new NotFound("Part not found", { partIds: ids.filter((id) => !found.has(id)) });
  }
  return new Map(rows.map((r) => [r.id, r]));
}

/** Weighted average cost after receiving `addQty` at `addCost` (spec §5.3). */
export function recalcAvgCost(oldQty: number, oldAvg: string, addQty: number, addCost: string): string {
  if (oldQty <= 0) return fmt(D(addCost));
  const total = D(oldQty).times(oldAvg).plus(D(addQty).times(addCost));
  return fmt(round2(total.div(oldQty + addQty)));
}

/**
 * Changes a locked part's stock and appends the ledger row. Returns the updated part;
 * callers keep it in their map so several lines for one part chain correctly.
 */
export async function applyMovement(
  tx: Tx,
  part: LockedPart,
  m: {
    type: MovementType;
    qtyChange: number;
    unitCost: string;
    refType: string;
    refId: string;
    userId: string;
    affectsAvgCost: boolean;
  },
): Promise<LockedPart> {
  const newQty = part.qtyOnHand + m.qtyChange;
  if (newQty < 0) {
    throw new InsufficientStock({
      partId: part.id,
      sku: part.sku,
      available: part.qtyOnHand,
      requested: -m.qtyChange,
    });
  }
  const newAvg =
    m.affectsAvgCost && m.qtyChange > 0
      ? recalcAvgCost(part.qtyOnHand, part.avgCost, m.qtyChange, m.unitCost)
      : part.avgCost;

  await tx
    .update(parts)
    .set({ qtyOnHand: newQty, avgCost: newAvg, updatedAt: new Date() })
    .where(eq(parts.id, part.id));
  await tx.insert(stockMovements).values({
    partId: part.id,
    type: m.type,
    qtyChange: m.qtyChange,
    balanceAfter: newQty,
    unitCost: fmt(D(m.unitCost)),
    refType: m.refType,
    refId: m.refId,
    createdBy: m.userId,
  });
  return { ...part, qtyOnHand: newQty, avgCost: newAvg };
}
