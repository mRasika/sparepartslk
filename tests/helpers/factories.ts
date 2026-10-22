import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  partFitments,
  partPrices,
  parts,
  priceTiers,
  profiles,
  stockMovements,
  suppliers,
} from "@/server/db/schema";
import type { Role, SessionUser } from "@/server/auth";
import type { PartInput } from "@/server/services/catalog";

let counter = 0;

/** Inserts a profile with a random user id (no Supabase auth user needed). */
export async function makeUser(
  role: Role,
  overrides: Partial<{ fullName: string; email: string; isActive: boolean }> = {},
): Promise<SessionUser> {
  counter += 1;
  const id = randomUUID();
  const email = overrides.email ?? `${role}${counter}-${id.slice(0, 8)}@test.local`;
  const fullName = overrides.fullName ?? `Test ${role} ${counter}`;
  await db.insert(profiles).values({
    userId: id,
    email,
    fullName,
    role,
    isActive: overrides.isActive ?? true,
  });
  return { id, email, fullName, role };
}

const FACTORY_ADMIN_EMAIL = "factory-admin@test.local";

/** A shared admin used as created_by for rows factories write (Ruling R4). */
export async function factoryAdmin(): Promise<SessionUser> {
  const [row] = await db.select().from(profiles).where(eq(profiles.email, FACTORY_ADMIN_EMAIL));
  if (row) return { id: row.userId, email: row.email, fullName: row.fullName, role: row.role };
  return makeUser("admin", { email: FACTORY_ADMIN_EMAIL, fullName: "Factory Admin" });
}

export async function tierIds(): Promise<Record<"Retail" | "Dealer" | "Wholesale", string>> {
  const rows = await db.select().from(priceTiers);
  return Object.fromEntries(rows.map((r) => [r.name, r.id])) as Record<
    "Retail" | "Dealer" | "Wholesale",
    string
  >;
}

/**
 * Inserts a part with Retail 1000.00 / Dealer 900.00 / Wholesale 850.00 prices.
 * With `qty`, also writes a matching ADJUST movement so the ledger stays consistent.
 */
export async function makePart(
  overrides: Partial<PartInput> & { qty?: number; avgCost?: string } = {},
): Promise<{ id: string; sku: string }> {
  counter += 1;
  const { qty = 0, avgCost = "0.00", prices, fitmentIds = [], ...fields } = overrides;
  const sku = fields.sku ?? `PART-${counter}`;
  const [part] = await db
    .insert(parts)
    .values({
      name: `Test part ${counter}`,
      unit: "pcs",
      reorderLevel: 0,
      reorderQty: 0,
      isActive: true,
      ...(fields as Partial<typeof parts.$inferInsert>),
      sku,
      qtyOnHand: qty,
      avgCost,
    })
    .returning({ id: parts.id });

  const tiers = await tierIds();
  const priceRows = prices ?? [
    { tierId: tiers.Retail, price: "1000.00" },
    { tierId: tiers.Dealer, price: "900.00" },
    { tierId: tiers.Wholesale, price: "850.00" },
  ];
  if (priceRows.length) {
    await db.insert(partPrices).values(priceRows.map((p) => ({ partId: part.id, ...p })));
  }
  if (fitmentIds.length) {
    await db
      .insert(partFitments)
      .values(fitmentIds.map((vehicleModelId) => ({ partId: part.id, vehicleModelId })));
  }
  if (qty !== 0) {
    const admin = await factoryAdmin();
    await db.insert(stockMovements).values({
      partId: part.id,
      type: "ADJUST",
      qtyChange: qty,
      balanceAfter: qty,
      unitCost: avgCost,
      refType: "seed",
      createdBy: admin.id,
    });
  }
  return { id: part.id, sku };
}

export async function makeSupplier(overrides: Partial<{ name: string; isActive: boolean }> = {}) {
  counter += 1;
  const [row] = await db
    .insert(suppliers)
    .values({ name: overrides.name ?? `Supplier ${counter}`, isActive: overrides.isActive ?? true })
    .returning({ id: suppliers.id, name: suppliers.name });
  return row;
}
