import { sql } from "drizzle-orm";
import { check, date, pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";
import { audit, money } from "./columns";

/** Daily sales target history: each row applies from `effective_from` until the next row. */
export const salesTargets = pgTable(
  "sales_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull().unique(),
    dailyTarget: money("daily_target").notNull(),
    /** ISO weekdays the shop is shut: 1 = Monday … 7 = Sunday. */
    closedWeekdays: smallint("closed_weekdays").array().notNull().default(sql`'{}'`),
    ...audit(),
  },
  (t) => [
    check("sales_targets_positive", sql`${t.dailyTarget} > 0`),
    check(
      "sales_targets_weekdays",
      sql`${t.closedWeekdays} <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(${t.closedWeekdays}) < 7`,
    ),
  ],
);

/** Dates the shop is shut beyond its closed weekdays, e.g. Poya days. */
export const closedDays = pgTable("closed_days", {
  day: date("day", { mode: "string" }).primaryKey(),
  reason: text("reason"),
  ...audit(),
});
