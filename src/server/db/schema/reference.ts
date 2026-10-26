import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "staff"]);
export const paymentTypeEnum = pgEnum("payment_type", ["cash", "credit"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["issued", "cancelled"]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "bank", "cheque"]);
export const paymentStatusEnum = pgEnum("payment_status", ["active", "cancelled"]);
export const movementTypeEnum = pgEnum("movement_type", [
  "GRN",
  "SALE",
  "SALE_CANCEL",
  "RETURN",
  "ADJUST",
]);
export const adjustmentReasonEnum = pgEnum("adjustment_reason", [
  "damage",
  "count_correction",
  "lost",
  "other",
]);
export const docTypeEnum = pgEnum("doc_type", ["INV", "GRN", "CRN", "PAY", "ADJ", "QUO"]);
export const quotationStatusEnum = pgEnum("quotation_status", ["open", "converted", "cancelled"]);

/** One row per auth user. No FK to auth.users so the schema works on a plain Postgres test DB. */
export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  role: roleEnum("role").notNull().default("staff"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single-row table (id is always 1). */
export const settings = pgTable(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    businessName: text("business_name").notNull().default(""),
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    tin: text("tin").notNull().default(""),
    logoUrl: text("logo_url"),
    vatEnabled: boolean("vat_enabled").notNull().default(false),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2, mode: "string" })
      .notNull()
      .default("18.00"),
    staffMaxDiscountPct: numeric("staff_max_discount_pct", {
      precision: 5,
      scale: 2,
      mode: "string",
    })
      .notNull()
      .default("10.00"),
    defaultCreditDays: integer("default_credit_days").notNull().default(30),
    docPrefix: text("doc_prefix").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const vehicleModels = pgTable("vehicle_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  yearFrom: integer("year_from"),
  yearTo: integer("year_to"),
});

export const priceTiers = pgTable(
  "price_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    isDefault: boolean("is_default").notNull().default(false),
    /**
     * Rule for parts with no typed price on this tier: the default tier's price less this percent
     * (negative = above it). Ignored on the default tier.
     */
    discountPct: numeric("discount_pct", { precision: 5, scale: 2, mode: "string" }).notNull().default("0.00"),
    /** Round rule prices to the nearest multiple of this many rupees; 0 keeps cents. */
    roundTo: integer("round_to").notNull().default(0),
  },
  (t) => [
    uniqueIndex("price_tiers_one_default").on(t.isDefault).where(sql`${t.isDefault}`),
    check("price_tiers_discount_pct_range", sql`${t.discountPct} > -100 and ${t.discountPct} < 100`),
    check("price_tiers_round_to_non_negative", sql`${t.roundTo} >= 0`),
  ],
);
