import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { optionalText } from "@/lib/validation";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { parts, profiles, stockAdjustmentItems, stockAdjustments } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";
import { applyMovement, lockParts } from "@/server/services/inventory";
import { nextNumber } from "@/server/services/sequences";

export const ADJUSTMENT_REASONS = ["damage", "count_correction", "lost", "other"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const adjustmentInputSchema = z.object({
  reason: z.enum(ADJUSTMENT_REASONS, "Choose a reason"),
  note: optionalText(500),
  lines: z
    .array(
      z.object({
        partId: z.uuid(),
        qtyChange: z.coerce
          .number()
          .int("Use whole units")
          .refine((n) => n !== 0, "Change can't be 0"),
      }),
    )
    .min(1, "Add at least one part"),
});

export type AdjustmentInput = z.input<typeof adjustmentInputSchema>;

/**
 * Corrects stock with a reason. Staff may only write stock off (damage/lost, decreases only).
 * Every line enters at the part's current average cost, so the average never moves.
 */
export async function createAdjustment(
  user: SessionUser,
  input: AdjustmentInput,
): Promise<{ id: string; number: string }> {
  const data = adjustmentInputSchema.parse(input);
  if (user.role !== "admin") {
    const writeOff = data.reason === "damage" || data.reason === "lost";
    if (!writeOff || data.lines.some((l) => l.qtyChange > 0)) {
      throw new Forbidden("Staff can only reduce stock for damaged or lost items");
    }
  }

  return db.transaction(async (tx) => {
    const locked = await lockParts(tx, data.lines.map((l) => l.partId));
    const number = await nextNumber(tx, "ADJ");
    const [adj] = await tx
      .insert(stockAdjustments)
      .values({ number, reason: data.reason, note: data.note, createdBy: user.id })
      .returning({ id: stockAdjustments.id });

    for (const [i, line] of data.lines.entries()) {
      const part = locked.get(line.partId)!;
      await tx.insert(stockAdjustmentItems).values({
        adjustmentId: adj.id,
        lineNo: i + 1,
        partId: line.partId,
        qtyChange: line.qtyChange,
        unitCost: part.avgCost,
      });
      const updated = await applyMovement(tx, part, {
        type: "ADJUST",
        qtyChange: line.qtyChange,
        unitCost: part.avgCost,
        refType: "adjustment",
        refId: adj.id,
        userId: user.id,
        affectsAvgCost: true,
      });
      locked.set(line.partId, updated);
    }
    return { id: adj.id, number };
  });
}

export async function listAdjustments() {
  const rows = await db
    .select({
      id: stockAdjustments.id,
      number: stockAdjustments.number,
      reason: stockAdjustments.reason,
      note: stockAdjustments.note,
      createdAt: stockAdjustments.createdAt,
      createdByName: profiles.fullName,
    })
    .from(stockAdjustments)
    .innerJoin(profiles, eq(profiles.userId, stockAdjustments.createdBy))
    .orderBy(desc(stockAdjustments.createdAt))
    .limit(200);
  if (rows.length === 0) return [];

  const items = await db
    .select({
      adjustmentId: stockAdjustmentItems.adjustmentId,
      sku: parts.sku,
      qtyChange: stockAdjustmentItems.qtyChange,
    })
    .from(stockAdjustmentItems)
    .innerJoin(parts, eq(parts.id, stockAdjustmentItems.partId))
    .where(sql`${stockAdjustmentItems.adjustmentId} in ${rows.map((r) => r.id)}`)
    .orderBy(asc(stockAdjustmentItems.lineNo));

  return rows.map((r) => ({ ...r, items: items.filter((i) => i.adjustmentId === r.id) }));
}
