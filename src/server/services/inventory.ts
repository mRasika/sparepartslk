import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { D, fmt, round2 } from "@/lib/money";
import { escapeLike } from "@/lib/sql-text";
import type { SessionUser } from "@/server/auth";
import { db, type Tx } from "@/server/db/client";
import { categories, grnItems, grns, parts, stockMovements, suppliers } from "@/server/db/schema";
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

// ---------------------------------------------------------------- stock views

export type LowStockRow = {
  partId: string;
  sku: string;
  oemPartNo: string | null;
  name: string;
  qtyOnHand: number;
  reorderLevel: number;
  reorderQty: number;
  suggestedQty: number;
  lastSupplierId?: string;
  lastSupplierName?: string;
};

const lowStockWhere = sql`${parts.isActive} and ${parts.reorderLevel} > 0 and ${parts.qtyOnHand} <= ${parts.reorderLevel}`;

/** Active parts at or below their reorder level (spec §5.7), grouped by last supplier then SKU. */
export async function lowStock(): Promise<LowStockRow[]> {
  const rows = await db.execute<{
    part_id: string;
    sku: string;
    oem_part_no: string | null;
    name: string;
    qty_on_hand: number;
    reorder_level: number;
    reorder_qty: number;
    supplier_id: string | null;
    supplier_name: string | null;
  }>(sql`
    select p.id as part_id, p.sku, p.oem_part_no, p.name, p.qty_on_hand, p.reorder_level, p.reorder_qty,
           ls.supplier_id, ls.supplier_name
    from ${parts} p
    left join lateral (
      select s.id as supplier_id, s.name as supplier_name
      from ${grnItems} gi
      join ${grns} g on g.id = gi.grn_id
      join ${suppliers} s on s.id = g.supplier_id
      where gi.part_id = p.id
      order by g.created_at desc
      limit 1
    ) ls on true
    where p.is_active and p.reorder_level > 0 and p.qty_on_hand <= p.reorder_level
    order by ls.supplier_name asc nulls last, p.sku asc
  `);
  return rows.map((r) => ({
    partId: r.part_id,
    sku: r.sku,
    oemPartNo: r.oem_part_no,
    name: r.name,
    qtyOnHand: r.qty_on_hand,
    reorderLevel: r.reorder_level,
    reorderQty: r.reorder_qty,
    suggestedQty: r.reorder_qty > 0 ? r.reorder_qty : Math.max(r.reorder_level * 2 - r.qty_on_hand, 1),
    lastSupplierId: r.supplier_id ?? undefined,
    lastSupplierName: r.supplier_name ?? undefined,
  }));
}

export async function lowStockCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(parts).where(lowStockWhere);
  return row.n;
}

export type StockRow = {
  id: string;
  sku: string;
  oemPartNo: string | null;
  name: string;
  categoryName: string | null;
  binLocation: string | null;
  unit: string;
  qtyOnHand: number;
  reorderLevel: number;
  isActive: boolean;
  avgCost?: string;
  stockValue?: string;
};

/** Stock on hand. Admins also get average cost and stock value (qty × avg cost). */
export async function stockList(
  user: SessionUser,
  filters: { q?: string; categoryId?: string; lowOnly?: boolean; partIds?: string[] },
): Promise<StockRow[]> {
  // Narrowed to given parts (the Stock page's health filters) in SQL, so the row limit comes after.
  if (filters.partIds && filters.partIds.length === 0) return [];
  const where: SQL[] = [];
  if (filters.partIds) where.push(inArray(parts.id, filters.partIds));
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(sql`(${parts.sku} ilike ${like} or ${parts.name} ilike ${like} or ${parts.oemPartNo} ilike ${like})`);
  }
  if (filters.categoryId) where.push(eq(parts.categoryId, filters.categoryId));
  if (filters.lowOnly) where.push(lowStockWhere);

  const rows = await db
    .select({
      id: parts.id,
      sku: parts.sku,
      oemPartNo: parts.oemPartNo,
      name: parts.name,
      categoryName: categories.name,
      binLocation: parts.binLocation,
      unit: parts.unit,
      qtyOnHand: parts.qtyOnHand,
      reorderLevel: parts.reorderLevel,
      isActive: parts.isActive,
      avgCost: parts.avgCost,
    })
    .from(parts)
    .leftJoin(categories, eq(categories.id, parts.categoryId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(parts.sku))
    .limit(1000);

  return rows.map((r): StockRow => {
    if (user.role !== "admin") {
      const { avgCost: _cost, ...rest } = r;
      void _cost;
      return rest;
    }
    return { ...r, stockValue: fmt(D(r.qtyOnHand).times(r.avgCost)) };
  });
}
