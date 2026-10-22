import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { colomboDate } from "@/lib/dates";
import { D, fmt, round2, sum } from "@/lib/money";
import { escapeLike } from "@/lib/sql-text";
import { moneyString, optionalText } from "@/lib/validation";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { grnItems, grns, parts, profiles, suppliers } from "@/server/db/schema";
import { InvalidState, NotFound } from "@/server/errors";
import { applyMovement, lockParts } from "@/server/services/inventory";
import { nextNumber } from "@/server/services/sequences";

// ---------------------------------------------------------------- suppliers

export const supplierInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: optionalText(40),
  address: optionalText(300),
  tin: optionalText(40),
  isActive: z.boolean().default(true),
});

export type SupplierInput = z.input<typeof supplierInputSchema>;

export async function listSuppliers(opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(suppliers)
    .where(opts.activeOnly ? eq(suppliers.isActive, true) : undefined)
    .orderBy(asc(suppliers.name));
}

/** Both roles may add and edit suppliers (spec §6). */
export async function upsertSupplier(_user: SessionUser, input: SupplierInput): Promise<{ id: string }> {
  const { id, ...data } = supplierInputSchema.parse(input);
  if (id) {
    const rows = await db.update(suppliers).set(data).where(eq(suppliers.id, id)).returning({ id: suppliers.id });
    if (!rows.length) throw new NotFound("Supplier not found");
    return rows[0];
  }
  const [row] = await db.insert(suppliers).values(data).returning({ id: suppliers.id });
  return row;
}

// ---------------------------------------------------------------- GRN

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-22");

export const grnInputSchema = z.object({
  supplierId: z.uuid("Choose a supplier"),
  supplierInvoiceNo: optionalText(60),
  receivedDate: isoDate.optional(),
  note: optionalText(500),
  lines: z
    .array(
      z.object({
        partId: z.uuid(),
        qty: z.coerce.number().int().positive("Quantity must be at least 1"),
        unitCost: moneyString,
      }),
    )
    .min(1, "Add at least one part"),
});

export type GrnInput = z.input<typeof grnInputSchema>;

/** Receives stock: one transaction that locks the parts, numbers the GRN and moves stock in. */
export async function createGrn(user: SessionUser, input: GrnInput): Promise<{ id: string; number: string }> {
  const data = grnInputSchema.parse(input);
  const lineTotals = data.lines.map((l) => round2(D(l.qty).times(l.unitCost)));

  return db.transaction(async (tx) => {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, data.supplierId));
    if (!supplier) throw new NotFound("Supplier not found");
    if (!supplier.isActive) throw new InvalidState(`${supplier.name} is inactive`);

    const locked = await lockParts(tx, data.lines.map((l) => l.partId));
    const number = await nextNumber(tx, "GRN");
    const [grn] = await tx
      .insert(grns)
      .values({
        number,
        supplierId: data.supplierId,
        supplierInvoiceNo: data.supplierInvoiceNo,
        receivedDate: data.receivedDate ?? colomboDate(),
        total: fmt(sum(lineTotals)),
        note: data.note,
        createdBy: user.id,
      })
      .returning({ id: grns.id });

    await tx
      .insert(grnItems)
      .values(
        data.lines.map((l, i) => ({ grnId: grn.id, lineNo: i + 1, partId: l.partId, qty: l.qty, unitCost: l.unitCost })),
      );

    for (const line of data.lines) {
      const updated = await applyMovement(tx, locked.get(line.partId)!, {
        type: "GRN",
        qtyChange: line.qty,
        unitCost: line.unitCost,
        refType: "grn",
        refId: grn.id,
        userId: user.id,
        affectsAvgCost: true,
      });
      locked.set(line.partId, updated);
    }
    return { id: grn.id, number };
  });
}

export type GrnDetail = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNo: string | null;
  receivedDate: string;
  total: string;
  note: string | null;
  createdByName: string;
  createdAt: Date;
  items: { id: string; partId: string; sku: string; name: string; qty: number; unitCost: string; lineTotal: string }[];
};

/** Staff see the GRN's own unit costs (they enter them) but never parts.avg_cost (Ruling R6). */
export async function getGrn(_user: SessionUser, id: string): Promise<GrnDetail> {
  if (!z.uuid().safeParse(id).success) throw new NotFound("GRN not found");
  const [header] = await db
    .select({
      id: grns.id,
      number: grns.number,
      supplierId: grns.supplierId,
      supplierName: suppliers.name,
      supplierInvoiceNo: grns.supplierInvoiceNo,
      receivedDate: grns.receivedDate,
      total: grns.total,
      note: grns.note,
      createdByName: profiles.fullName,
      createdAt: grns.createdAt,
    })
    .from(grns)
    .innerJoin(suppliers, eq(suppliers.id, grns.supplierId))
    .innerJoin(profiles, eq(profiles.userId, grns.createdBy))
    .where(eq(grns.id, id));
  if (!header) throw new NotFound("GRN not found");

  const items = await db
    .select({
      id: grnItems.id,
      partId: grnItems.partId,
      sku: parts.sku,
      name: parts.name,
      qty: grnItems.qty,
      unitCost: grnItems.unitCost,
    })
    .from(grnItems)
    .innerJoin(parts, eq(parts.id, grnItems.partId))
    .where(eq(grnItems.grnId, id))
    .orderBy(asc(grnItems.lineNo));

  return {
    ...header,
    items: items.map((i) => ({ ...i, lineTotal: fmt(D(i.qty).times(i.unitCost)) })),
  };
}

export async function listGrns(filters: { q?: string; supplierId?: string; from?: string; to?: string } = {}) {
  const where: SQL[] = [];
  if (filters.q?.trim()) {
    const q = `%${escapeLike(filters.q.trim())}%`;
    where.push(sql`(${grns.number} ilike ${q} or ${grns.supplierInvoiceNo} ilike ${q})`);
  }
  if (filters.supplierId) where.push(eq(grns.supplierId, filters.supplierId));
  if (filters.from) where.push(gte(grns.receivedDate, filters.from));
  if (filters.to) where.push(lte(grns.receivedDate, filters.to));

  return db
    .select({
      id: grns.id,
      number: grns.number,
      supplierName: suppliers.name,
      supplierInvoiceNo: grns.supplierInvoiceNo,
      receivedDate: grns.receivedDate,
      total: grns.total,
      itemCount: sql<number>`(select count(*)::int from ${grnItems} where ${grnItems.grnId} = ${grns.id})`,
    })
    .from(grns)
    .innerJoin(suppliers, eq(suppliers.id, grns.supplierId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(grns.createdAt))
    .limit(200);
}

/** Supplier on each part's most recent GRN. Parts never received are absent. */
export async function lastSupplierForParts(
  partIds: string[],
): Promise<Map<string, { supplierId: string; supplierName: string }>> {
  if (partIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([grnItems.partId], {
      partId: grnItems.partId,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
    })
    .from(grnItems)
    .innerJoin(grns, eq(grns.id, grnItems.grnId))
    .innerJoin(suppliers, eq(suppliers.id, grns.supplierId))
    .where(inArray(grnItems.partId, partIds))
    .orderBy(grnItems.partId, desc(grns.createdAt));
  return new Map(rows.map((r) => [r.partId, { supplierId: r.supplierId, supplierName: r.supplierName }]));
}

