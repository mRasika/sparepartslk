import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { priceTiers } from "./reference";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    businessName: text("business_name"),
    phone: text("phone"),
    address: text("address"),
    tin: text("tin"),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => priceTiers.id),
    creditLimit: numeric("credit_limit", { precision: 12, scale: 2, mode: "string" })
      .notNull()
      .default("0.00"),
    creditDays: integer("credit_days").notNull().default(0),
    isWalkIn: boolean("is_walk_in").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("customers_credit_non_negative", sql`${t.creditLimit} >= 0 and ${t.creditDays} >= 0`),
    uniqueIndex("customers_one_walk_in").on(t.isWalkIn).where(sql`${t.isWalkIn}`),
  ],
);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  tin: text("tin"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
