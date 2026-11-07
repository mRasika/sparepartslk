import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  customers,
  partFitments,
  partPrices,
  parts,
  priceTiers,
  profiles,
  stockMovements,
  suppliers,
  user,
} from "@/server/db/schema";
import type { Role, SessionUser } from "@/server/auth";
import { createLogin } from "@/server/auth-admin";
import type { PartInput } from "@/server/services/catalog";

let counter = 0;

/** Inserts a profile with a random user id, with a matching Better Auth `user` row, no password. */
export async function makeUser(
  role: Role,
  overrides: Partial<{ fullName: string; email: string; isActive: boolean; canGetEmails: boolean }> = {},
): Promise<SessionUser> {
  counter += 1;
  const id = randomUUID();
  const email = overrides.email ?? `${role}${counter}-${id.slice(0, 8)}@test.local`;
  const fullName = overrides.fullName ?? `Test ${role} ${counter}`;
  await db.transaction(async (tx) => {
    await tx.insert(user).values({ id, email, name: fullName, emailVerified: true });
    await tx.insert(profiles).values({
      userId: id,
      email,
      fullName,
      role,
      isActive: overrides.isActive ?? true,
      canGetEmails: overrides.canGetEmails ?? false,
    });
  });
  return { id, email, fullName, role };
}

export const LOGIN_PASSWORD = "factory-pass-1";

/** Like makeUser, but a real login: user, credential account (password LOGIN_PASSWORD) and profile. */
export async function makeLogin(
  role: Role,
  overrides: Partial<{ fullName: string; email: string; canGetEmails: boolean }> = {},
): Promise<SessionUser> {
  counter += 1;
  const email = overrides.email ?? `${role}${counter}-${randomUUID().slice(0, 8)}@test.local`;
  const fullName = overrides.fullName ?? `Test ${role} ${counter}`;
  const { id } = await createLogin({ email, name: fullName, password: LOGIN_PASSWORD, role, canGetEmails: overrides.canGetEmails });
  return { id, email, fullName, role };
}

const FACTORY_ADMIN_EMAIL = "factory-admin@test.local";

/** A shared admin used as created_by for rows factories write (Ruling R4). */
export async function factoryAdmin(): Promise<SessionUser> {
  const existing = async () => {
    const [row] = await db.select().from(profiles).where(eq(profiles.email, FACTORY_ADMIN_EMAIL));
    return row && { id: row.userId, email: row.email, fullName: row.fullName, role: row.role };
  };
  const found = await existing();
  if (found) return found;
  try {
    return await makeUser("admin", { email: FACTORY_ADMIN_EMAIL, fullName: "Factory Admin" });
  } catch (e) {
    // A parallel call in the same test made it first (user.email is unique); its transaction has
    // committed by the time ours is refused, so read that one.
    const again = await existing();
    if (again) return again;
    throw e;
  }
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

/** A customer on the Retail tier (or `tier`), cash-only unless creditLimit is given. */
export async function makeCustomer(
  overrides: Partial<{
    name: string;
    tier: "Retail" | "Dealer" | "Wholesale";
    creditLimit: string;
    creditDays: number;
    isActive: boolean;
  }> = {},
): Promise<{ id: string; name: string; tierId: string }> {
  counter += 1;
  const tiers = await tierIds();
  const tierId = tiers[overrides.tier ?? "Retail"];
  const [row] = await db
    .insert(customers)
    .values({
      name: overrides.name ?? `Customer ${counter}`,
      tierId,
      creditLimit: overrides.creditLimit ?? "0.00",
      creditDays: overrides.creditDays ?? 30,
      isActive: overrides.isActive ?? true,
    })
    .returning({ id: customers.id, name: customers.name });
  return { ...row, tierId };
}

export async function makeSupplier(overrides: Partial<{ name: string; isActive: boolean }> = {}) {
  counter += 1;
  const [row] = await db
    .insert(suppliers)
    .values({ name: overrides.name ?? `Supplier ${counter}`, isActive: overrides.isActive ?? true })
    .returning({ id: suppliers.id, name: suppliers.name });
  return row;
}
