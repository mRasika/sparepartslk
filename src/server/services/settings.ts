import { db, type Executor } from "@/server/db/client";
import { settings } from "@/server/db/schema";

export type Settings = typeof settings.$inferSelect;

/** The single settings row (seeded by insertBaseData). */
export async function getSettings(tx: Executor = db): Promise<Settings> {
  const [row] = await tx.select().from(settings);
  if (!row) throw new Error("Settings row missing; run pnpm db:seed");
  return row;
}
