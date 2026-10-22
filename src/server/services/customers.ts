import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { escapeLike } from "@/lib/sql-text";
import { moneyString, optionalText } from "@/lib/validation";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers, priceTiers } from "@/server/db/schema";
import { Forbidden, InvalidState, NotFound } from "@/server/errors";

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  businessName: optionalText(160),
  phone: optionalText(40),
  address: optionalText(300),
  tin: optionalText(40),
  tierId: z.uuid("Choose a price tier"),
  creditLimit: moneyString,
  creditDays: z.coerce.number().int().min(0).max(365),
  isActive: z.boolean(),
});

export type CustomerInput = z.input<typeof customerInputSchema>;

async function defaultTierId(): Promise<string> {
  const [row] = await db.select({ id: priceTiers.id }).from(priceTiers).where(eq(priceTiers.isDefault, true));
  return row.id;
}

/** Staff may add customers, but only cash customers on the default tier (spec §6). */
export async function createCustomer(user: SessionUser, input: CustomerInput): Promise<{ id: string }> {
  const data = customerInputSchema.parse(input);
  if (user.role !== "admin") {
    if (data.creditLimit !== "0.00") throw new Forbidden("Only an admin can give a customer credit");
    if (data.tierId !== (await defaultTierId())) throw new Forbidden("Only an admin can set a customer's price tier");
  }
  const [row] = await db.insert(customers).values(data).returning({ id: customers.id });
  return row;
}

/** Staff may edit contact details; tier and credit terms are admin-only. */
export async function updateCustomer(user: SessionUser, id: string, input: CustomerInput): Promise<void> {
  const data = customerInputSchema.parse(input);
  const [current] = await db.select().from(customers).where(eq(customers.id, id));
  if (!current) throw new NotFound("Customer not found");

  if (user.role !== "admin") {
    const termsChanged =
      data.tierId !== current.tierId ||
      data.creditLimit !== current.creditLimit ||
      data.creditDays !== current.creditDays;
    if (termsChanged) throw new Forbidden("Only an admin can change price tier or credit terms");
  }
  if (current.isWalkIn) {
    if (data.creditLimit !== "0.00") throw new InvalidState("The walk-in customer is cash only");
    if (!data.isActive) throw new InvalidState("The walk-in customer can't be turned off");
  }
  await db.update(customers).set(data).where(eq(customers.id, id));
}

export type CustomerRow = {
  id: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  address: string | null;
  tin: string | null;
  tierId: string;
  tierName: string;
  creditLimit: string;
  creditDays: number;
  isWalkIn: boolean;
  isActive: boolean;
};

const customerColumns = {
  id: customers.id,
  name: customers.name,
  businessName: customers.businessName,
  phone: customers.phone,
  address: customers.address,
  tin: customers.tin,
  tierId: customers.tierId,
  tierName: priceTiers.name,
  creditLimit: customers.creditLimit,
  creditDays: customers.creditDays,
  isWalkIn: customers.isWalkIn,
  isActive: customers.isActive,
};

export async function listCustomers(filters: { q?: string; activeOnly?: boolean; limit?: number } = {}): Promise<CustomerRow[]> {
  const where: SQL[] = [];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      sql`(${customers.name} ilike ${like} or ${customers.businessName} ilike ${like} or ${customers.phone} ilike ${like})`,
    );
  }
  if (filters.activeOnly) where.push(eq(customers.isActive, true));
  return db
    .select(customerColumns)
    .from(customers)
    .innerJoin(priceTiers, eq(priceTiers.id, customers.tierId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${customers.isWalkIn} desc`, asc(customers.name))
    .limit(filters.limit ?? 500);
}

export async function getCustomer(id: string): Promise<CustomerRow> {
  if (!z.uuid().safeParse(id).success) throw new NotFound("Customer not found");
  const [row] = await db
    .select(customerColumns)
    .from(customers)
    .innerJoin(priceTiers, eq(priceTiers.id, customers.tierId))
    .where(eq(customers.id, id));
  if (!row) throw new NotFound("Customer not found");
  return row;
}
