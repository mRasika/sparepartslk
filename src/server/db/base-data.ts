import { eq } from "drizzle-orm";
import type { Executor } from "./client";
import { customers, priceTiers, settings } from "./schema";

export const DEFAULT_TIERS = [
  { name: "Retail", isDefault: true },
  { name: "Dealer", isDefault: false },
  { name: "Wholesale", isDefault: false },
] as const;

export const WALK_IN_CUSTOMER_NAME = "Walk-in Customer";

/** Inserts the price tiers, the walk-in customer and the settings row. Safe to run repeatedly. */
export async function insertBaseData(db: Executor): Promise<void> {
  await db
    .insert(priceTiers)
    .values(DEFAULT_TIERS.map((t) => ({ ...t })))
    .onConflictDoNothing({ target: priceTiers.name });

  const [retail] = await db
    .select({ id: priceTiers.id })
    .from(priceTiers)
    .where(eq(priceTiers.isDefault, true));

  await db
    .insert(customers)
    .values({
      name: WALK_IN_CUSTOMER_NAME,
      tierId: retail.id,
      creditLimit: "0.00",
      creditDays: 0,
      isWalkIn: true,
    })
    .onConflictDoNothing();

  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
}
