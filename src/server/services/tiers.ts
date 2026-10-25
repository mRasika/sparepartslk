import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ROUND_TO_OPTIONS } from "@/lib/tier-rule";
import { requireRole, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers, partPrices, parts, priceTiers } from "@/server/db/schema";
import { DomainError, NotFound } from "@/server/errors";
import { ruleSql } from "@/server/services/pricing";

const roundTo = z.coerce
  .number()
  .int()
  .refine((n) => (ROUND_TO_OPTIONS as readonly number[]).includes(n), "Choose a rounding option");

const percent = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(\.\d{1,2})?$/, "Enter a percent like 10 or -5.5")
    .refine((v) => Number(v) > min && Number(v) < max, message);

export const tierInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  discountPct: percent(-100, 100, "Keep the rule between −99.99% and 99.99%"),
  roundTo,
});

export type TierInput = z.input<typeof tierInputSchema>;

function rethrowDuplicate(e: unknown, name: string): never {
  const err = e as { cause?: { code?: string } };
  if (err.cause?.code === "23505") {
    throw new DomainError("Duplicate", `A tier called "${name}" already exists`, { field: "name" });
  }
  throw e;
}

async function assertNameFree(name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: priceTiers.id })
    .from(priceTiers)
    .where(sql`lower(${priceTiers.name}) = lower(${name})`);
  if (clash && clash.id !== exceptId) {
    throw new DomainError("Duplicate", `A tier called "${name}" already exists`, { field: "name" });
  }
}

export async function createTier(user: SessionUser, input: TierInput): Promise<{ id: string }> {
  requireRole(user, "admin");
  const data = tierInputSchema.parse(input);
  await assertNameFree(data.name);
  try {
    const [row] = await db.insert(priceTiers).values(data).returning({ id: priceTiers.id });
    return row;
  } catch (e) {
    rethrowDuplicate(e, data.name);
  }
}

/** Renames a tier and sets its rule. The default tier is the base price, so it never has a rule. */
export async function updateTier(user: SessionUser, id: string, input: TierInput): Promise<void> {
  requireRole(user, "admin");
  const data = tierInputSchema.parse(input);
  const [current] = await db.select().from(priceTiers).where(eq(priceTiers.id, id));
  if (!current) throw new NotFound("Tier not found");
  await assertNameFree(data.name, id);
  const values = current.isDefault ? { name: data.name, discountPct: "0", roundTo: 0 } : data;
  try {
    await db.update(priceTiers).set(values).where(eq(priceTiers.id, id));
  } catch (e) {
    rethrowDuplicate(e, data.name);
  }
}

export type TierStatsRow = {
  id: string;
  name: string;
  isDefault: boolean;
  discountPct: string;
  roundTo: number;
  customerCount: number;
  typedPriceCount: number;
  /** Active parts this tier would sell below average cost (typed price or rule). Admin data. */
  belowCostCount: number;
};

export async function listTiersWithStats(): Promise<TierStatsRow[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    is_default: boolean;
    discount_pct: string;
    round_to: number;
    customer_count: number;
    typed_price_count: number;
    below_cost_count: number;
  }>(sql`
    select t.id, t.name, t.is_default, t.discount_pct::text, t.round_to,
      (select count(*)::int from ${customers} c where c.tier_id = t.id) as customer_count,
      (select count(*)::int from ${partPrices} pp where pp.tier_id = t.id) as typed_price_count,
      (select count(*)::int from ${parts} p
        left join ${partPrices} own on own.part_id = p.id and own.tier_id = t.id
        left join ${partPrices} base on base.part_id = p.id and base.tier_id = d.id
        where p.is_active and p.avg_cost > 0
          and coalesce(own.price, case when t.is_default then base.price
                else ${ruleSql(sql`base.price`, sql`t.discount_pct`, sql`t.round_to`)} end) < p.avg_cost
      ) as below_cost_count
    from ${priceTiers} t
    cross join (select id from ${priceTiers} where is_default) d
    order by t.is_default desc, t.name
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.is_default,
    discountPct: r.discount_pct,
    roundTo: r.round_to,
    customerCount: r.customer_count,
    typedPriceCount: r.typed_price_count,
    belowCostCount: r.below_cost_count,
  }));
}

// ---------------------------------------------------------------- bulk price change

export const bulkChangeSchema = z.object({
  tierId: z.uuid("Choose a tier"),
  categoryId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  brandId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  changePct: percent(-90, 500, "Keep the change between −89.99% and 499.99%").refine(
    (v) => Number(v) !== 0,
    "Enter a change other than 0",
  ),
  roundTo,
});

export type BulkChangeInput = z.input<typeof bulkChangeSchema>;

/** Typed prices on the tier, narrowed by category / brand. */
function bulkWhere(data: z.output<typeof bulkChangeSchema>) {
  return sql`pp.tier_id = ${data.tierId}
    ${data.categoryId ? sql`and p.category_id = ${data.categoryId}` : sql``}
    ${data.brandId ? sql`and p.brand_id = ${data.brandId}` : sql``}`;
}

/** `changePct` up is the rule maths with the sign flipped: price × (100 + change) / 100. */
const newPriceSql = (data: z.output<typeof bulkChangeSchema>) =>
  ruleSql(sql`pp.price`, sql`${String(-Number(data.changePct))}::numeric`, sql`${data.roundTo}::int`);

export type BulkPreview = {
  count: number;
  belowCostCount: number;
  rows: { partId: string; sku: string; name: string; oldPrice: string; newPrice: string; avgCost: string; belowCost: boolean }[];
};

/** What a bulk change would do, without writing. Shows the first 200 parts. */
export async function previewBulkPriceChange(user: SessionUser, input: BulkChangeInput): Promise<BulkPreview> {
  requireRole(user, "admin");
  const data = bulkChangeSchema.parse(input);
  const rows = await db.execute<{
    part_id: string;
    sku: string;
    name: string;
    old_price: string;
    new_price: string;
    avg_cost: string;
    below_cost: boolean;
    total: number;
    below_total: number;
  }>(sql`
    select *, count(*) over ()::int as total,
           (count(*) filter (where below_cost) over ())::int as below_total
    from (
      select p.id as part_id, p.sku, p.name, pp.price::text as old_price, ${newPriceSql(data)}::text as new_price,
             p.avg_cost::text, (p.avg_cost > 0 and ${newPriceSql(data)} < p.avg_cost) as below_cost
      from ${partPrices} pp join ${parts} p on p.id = pp.part_id
      where ${bulkWhere(data)}
    ) x
    order by sku
    limit 200
  `);
  return {
    count: rows[0]?.total ?? 0,
    belowCostCount: rows[0]?.below_total ?? 0,
    rows: rows.map((r) => ({
      partId: r.part_id,
      sku: r.sku,
      name: r.name,
      oldPrice: r.old_price,
      newPrice: r.new_price,
      avgCost: r.avg_cost,
      belowCost: r.below_cost,
    })),
  };
}

/** Applies a bulk change in one statement. Parts following the tier's rule have no typed price and aren't touched. */
export async function applyBulkPriceChange(user: SessionUser, input: BulkChangeInput): Promise<{ updated: number }> {
  requireRole(user, "admin");
  const data = bulkChangeSchema.parse(input);
  const updated = await db.execute(sql`
    update ${partPrices} pp set price = ${newPriceSql(data)}
    from ${parts} p
    where p.id = pp.part_id and ${bulkWhere(data)}
  `);
  return { updated: updated.count };
}
