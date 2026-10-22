import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { escapeLike } from "@/lib/sql-text";
import { moneyString, optionalId, optionalText } from "@/lib/validation";
import { requireRole, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import {
  brands,
  categories,
  partFitments,
  partPrices,
  parts,
  priceTiers,
  profiles,
  stockMovements,
  vehicleModels,
} from "@/server/db/schema";
import { DomainError, NotFound } from "@/server/errors";

// ---------------------------------------------------------------- input

export const partInputSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(40),
  name: z.string().trim().min(1, "Name is required").max(200),
  oemPartNo: optionalText(60),
  barcode: optionalText(60),
  categoryId: optionalId,
  brandId: optionalId,
  unit: z.string().trim().min(1).max(20).default("pcs"),
  binLocation: optionalText(40),
  reorderLevel: z.coerce.number().int().min(0, "Can't be negative"),
  reorderQty: z.coerce.number().int().min(0, "Can't be negative"),
  isActive: z.boolean(),
  prices: z
    .array(z.object({ tierId: z.uuid(), price: moneyString }))
    .refine((ps) => new Set(ps.map((p) => p.tierId)).size === ps.length, "One price per tier"),
  fitmentIds: z.array(z.uuid()).default([]),
});

export type PartInput = z.input<typeof partInputSchema>;

// ---------------------------------------------------------------- views

export type PartListRow = {
  id: string;
  sku: string;
  oemPartNo: string | null;
  barcode: string | null;
  name: string;
  categoryName: string | null;
  brandName: string | null;
  unit: string;
  binLocation: string | null;
  qtyOnHand: number;
  reorderLevel: number;
  isActive: boolean;
};

export type PartMovement = {
  id: string;
  type: "GRN" | "SALE" | "SALE_CANCEL" | "RETURN" | "ADJUST";
  qtyChange: number;
  balanceAfter: number;
  unitCost?: string;
  refType: string;
  refId: string | null;
  createdAt: Date;
  createdByName: string;
};

export type PartDetail = {
  id: string;
  sku: string;
  oemPartNo: string | null;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  unit: string;
  binLocation: string | null;
  qtyOnHand: number;
  avgCost?: string;
  reorderLevel: number;
  reorderQty: number;
  isActive: boolean;
  prices: { tierId: string; tierName: string; price: string }[];
  fitments: { vehicleModelId: string; label: string }[];
  movements: PartMovement[];
};

/** Removes cost fields for staff (spec §6). Admins get the row unchanged. */
export function toStaffView<T extends { avgCost?: string; unitCost?: string }>(
  user: SessionUser,
  row: T,
): T {
  if (user.role === "admin") return row;
  const copy = { ...row };
  delete copy.avgCost;
  delete copy.unitCost;
  return copy;
}

// ---------------------------------------------------------------- parts

function rethrowDuplicate(e: unknown): never {
  const err = e as { cause?: { code?: string; constraint_name?: string } };
  if (err.cause?.code === "23505") {
    const field = err.cause.constraint_name?.includes("barcode") ? "barcode" : "sku";
    throw new DomainError("Duplicate", `Another part already uses this ${field === "sku" ? "SKU" : "barcode"}`, {
      field,
    });
  }
  throw e;
}

async function writePriceAndFitments(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  partId: string,
  input: z.output<typeof partInputSchema>,
) {
  await tx.delete(partPrices).where(eq(partPrices.partId, partId));
  if (input.prices.length) {
    await tx.insert(partPrices).values(input.prices.map((p) => ({ partId, ...p })));
  }
  await tx.delete(partFitments).where(eq(partFitments.partId, partId));
  if (input.fitmentIds.length) {
    await tx
      .insert(partFitments)
      .values([...new Set(input.fitmentIds)].map((vehicleModelId) => ({ partId, vehicleModelId })));
  }
}

function partFields(input: z.output<typeof partInputSchema>) {
  const { prices: _prices, fitmentIds: _fitments, ...fields } = input;
  void _prices;
  void _fitments;
  return fields;
}

export async function createPart(user: SessionUser, input: PartInput): Promise<{ id: string }> {
  requireRole(user, "admin");
  const data = partInputSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(parts)
        .values({ ...partFields(data), qtyOnHand: 0, avgCost: "0.00" })
        .returning({ id: parts.id });
      await writePriceAndFitments(tx, row.id, data);
      return { id: row.id };
    });
  } catch (e) {
    rethrowDuplicate(e);
  }
}

/** Updates identity, prices and fitments. Never touches qty_on_hand or avg_cost. */
export async function updatePart(user: SessionUser, id: string, input: PartInput): Promise<void> {
  requireRole(user, "admin");
  const data = partInputSchema.parse(input);
  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(parts)
        .set({ ...partFields(data), updatedAt: new Date() })
        .where(eq(parts.id, id))
        .returning({ id: parts.id });
      if (!updated.length) throw new NotFound("Part not found");
      await writePriceAndFitments(tx, id, data);
    });
  } catch (e) {
    rethrowDuplicate(e);
  }
}

/**
 * Part search for lists and billing. Exact SKU/barcode/OEM matches first, then SKU/OEM prefix,
 * then name matches (substring or trigram word similarity). Rows never include cost.
 */
export async function searchParts(
  q: string,
  opts: {
    vehicleModelId?: string;
    categoryId?: string;
    brandId?: string;
    activeOnly?: boolean;
    limit?: number;
  } = {},
): Promise<PartListRow[]> {
  const term = q.trim();
  const prefix = `${escapeLike(term)}%`;
  const contains = `%${escapeLike(term)}%`;

  const where: SQL[] = [];
  if (term) {
    where.push(sql`(
      ${parts.sku} ilike ${prefix}
      or ${parts.oemPartNo} ilike ${prefix}
      or lower(${parts.barcode}) = lower(${term})
      or ${parts.name} ilike ${contains}
      or ${term} <% ${parts.name}
    )`);
  }
  if (opts.vehicleModelId) {
    where.push(sql`exists (
      select 1 from ${partFitments}
      where ${partFitments.partId} = ${parts.id} and ${partFitments.vehicleModelId} = ${opts.vehicleModelId}
    )`);
  }
  if (opts.categoryId) where.push(eq(parts.categoryId, opts.categoryId));
  if (opts.brandId) where.push(eq(parts.brandId, opts.brandId));
  if (opts.activeOnly) where.push(eq(parts.isActive, true));

  const orderBy: SQL[] = term
    ? [
        sql`case
          when lower(${parts.sku}) = lower(${term})
            or lower(coalesce(${parts.barcode}, '')) = lower(${term})
            or lower(coalesce(${parts.oemPartNo}, '')) = lower(${term}) then 0
          when ${parts.sku} ilike ${prefix} or ${parts.oemPartNo} ilike ${prefix} then 1
          else 2 end`,
        desc(sql`word_similarity(${term}, ${parts.name})`),
        asc(parts.sku),
      ]
    : [asc(parts.sku)];

  return db
    .select({
      id: parts.id,
      sku: parts.sku,
      oemPartNo: parts.oemPartNo,
      barcode: parts.barcode,
      name: parts.name,
      categoryName: categories.name,
      brandName: brands.name,
      unit: parts.unit,
      binLocation: parts.binLocation,
      qtyOnHand: parts.qtyOnHand,
      reorderLevel: parts.reorderLevel,
      isActive: parts.isActive,
    })
    .from(parts)
    .leftJoin(categories, eq(categories.id, parts.categoryId))
    .leftJoin(brands, eq(brands.id, parts.brandId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(...orderBy)
    .limit(opts.limit ?? 20);
}

export async function getPart(user: SessionUser, id: string): Promise<PartDetail> {
  if (!z.uuid().safeParse(id).success) throw new NotFound("Part not found");
  const [part] = await db
    .select({
      id: parts.id,
      sku: parts.sku,
      oemPartNo: parts.oemPartNo,
      barcode: parts.barcode,
      name: parts.name,
      categoryId: parts.categoryId,
      categoryName: categories.name,
      brandId: parts.brandId,
      brandName: brands.name,
      unit: parts.unit,
      binLocation: parts.binLocation,
      qtyOnHand: parts.qtyOnHand,
      avgCost: parts.avgCost,
      reorderLevel: parts.reorderLevel,
      reorderQty: parts.reorderQty,
      isActive: parts.isActive,
    })
    .from(parts)
    .leftJoin(categories, eq(categories.id, parts.categoryId))
    .leftJoin(brands, eq(brands.id, parts.brandId))
    .where(eq(parts.id, id));
  if (!part) throw new NotFound("Part not found");

  const [prices, fitments, movements] = await Promise.all([
    db
      .select({ tierId: partPrices.tierId, tierName: priceTiers.name, price: partPrices.price })
      .from(partPrices)
      .innerJoin(priceTiers, eq(priceTiers.id, partPrices.tierId))
      .where(eq(partPrices.partId, id))
      .orderBy(desc(priceTiers.isDefault), asc(priceTiers.name)),
    db
      .select({
        vehicleModelId: vehicleModels.id,
        label: vehicleModelLabel(),
      })
      .from(partFitments)
      .innerJoin(vehicleModels, eq(vehicleModels.id, partFitments.vehicleModelId))
      .where(eq(partFitments.partId, id))
      .orderBy(asc(vehicleModels.make), asc(vehicleModels.model)),
    db
      .select({
        id: stockMovements.id,
        type: stockMovements.type,
        qtyChange: stockMovements.qtyChange,
        balanceAfter: stockMovements.balanceAfter,
        unitCost: stockMovements.unitCost,
        refType: stockMovements.refType,
        refId: stockMovements.refId,
        createdAt: stockMovements.createdAt,
        createdByName: profiles.fullName,
      })
      .from(stockMovements)
      .innerJoin(profiles, eq(profiles.userId, stockMovements.createdBy))
      .where(eq(stockMovements.partId, id))
      .orderBy(desc(stockMovements.createdAt))
      .limit(50),
  ]);

  return toStaffView(user, {
    ...part,
    prices,
    fitments,
    movements: movements.map((m) => toStaffView<PartMovement>(user, m)),
  } as PartDetail);
}

export async function listPriceTiers() {
  return db
    .select({ id: priceTiers.id, name: priceTiers.name, isDefault: priceTiers.isDefault })
    .from(priceTiers)
    .orderBy(desc(priceTiers.isDefault), asc(priceTiers.name));
}

// ---------------------------------------------------------------- reference lists

const nameSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(80),
});

async function upsertNamed(
  table: typeof categories | typeof brands,
  input: z.input<typeof nameSchema>,
): Promise<{ id: string }> {
  const data = nameSchema.parse(input);
  try {
    if (data.id) {
      const rows = await db
        .update(table)
        .set({ name: data.name })
        .where(eq(table.id, data.id))
        .returning({ id: table.id });
      if (!rows.length) throw new NotFound();
      return rows[0];
    }
    const [row] = await db.insert(table).values({ name: data.name }).returning({ id: table.id });
    return row;
  } catch (e) {
    const err = e as { cause?: { code?: string } };
    if (err.cause?.code === "23505") {
      throw new DomainError("Duplicate", `"${data.name}" already exists`, { field: "name" });
    }
    throw e;
  }
}

export async function listCategories() {
  return db.select().from(categories).orderBy(asc(categories.name));
}

export async function upsertCategory(user: SessionUser, input: z.input<typeof nameSchema>) {
  requireRole(user, "admin");
  return upsertNamed(categories, input);
}

export async function listBrands() {
  return db.select().from(brands).orderBy(asc(brands.name));
}

export async function upsertBrand(user: SessionUser, input: z.input<typeof nameSchema>) {
  requireRole(user, "admin");
  return upsertNamed(brands, input);
}

function vehicleModelLabel() {
  return sql<string>`${vehicleModels.make} || ' ' || ${vehicleModels.model} || coalesce(
    ' (' || ${vehicleModels.yearFrom}::text || '–' || coalesce(${vehicleModels.yearTo}::text, '') || ')', '')`;
}

const vehicleModelSchema = z
  .object({
    id: z.uuid().optional(),
    make: z.string().trim().min(1, "Make is required").max(60),
    model: z.string().trim().min(1, "Model is required").max(60),
    yearFrom: z.coerce.number().int().min(1950).max(2100).nullish(),
    yearTo: z.coerce.number().int().min(1950).max(2100).nullish(),
  })
  .refine((v) => !v.yearFrom || !v.yearTo || v.yearTo >= v.yearFrom, {
    message: "End year must be after start year",
    path: ["yearTo"],
  });

export async function listVehicleModels() {
  return db
    .select({
      id: vehicleModels.id,
      make: vehicleModels.make,
      model: vehicleModels.model,
      yearFrom: vehicleModels.yearFrom,
      yearTo: vehicleModels.yearTo,
      label: vehicleModelLabel(),
    })
    .from(vehicleModels)
    .orderBy(asc(vehicleModels.make), asc(vehicleModels.model), asc(vehicleModels.yearFrom));
}

export async function upsertVehicleModel(
  user: SessionUser,
  input: z.input<typeof vehicleModelSchema>,
): Promise<{ id: string }> {
  requireRole(user, "admin");
  const { id, ...data } = vehicleModelSchema.parse(input);
  const values = { ...data, yearFrom: data.yearFrom ?? null, yearTo: data.yearTo ?? null };
  if (id) {
    const rows = await db
      .update(vehicleModels)
      .set(values)
      .where(eq(vehicleModels.id, id))
      .returning({ id: vehicleModels.id });
    if (!rows.length) throw new NotFound("Vehicle model not found");
    return rows[0];
  }
  const [row] = await db.insert(vehicleModels).values(values).returning({ id: vehicleModels.id });
  return row;
}
