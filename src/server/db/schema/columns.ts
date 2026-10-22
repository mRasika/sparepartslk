import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";
import { profiles } from "./reference";

/** numeric(12,2) read and written as a string; do the maths with src/lib/money.ts. */
export const money = (name: string) =>
  numeric(name, { precision: 12, scale: 2, mode: "string" });

/** created_by + created_at, required on every document table. */
export const audit = () => ({
  createdBy: uuid("created_by")
    .notNull()
    .references(() => profiles.userId),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
