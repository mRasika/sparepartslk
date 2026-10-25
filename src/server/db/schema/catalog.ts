import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { brands, categories, priceTiers, vehicleModels } from "./reference";

export const parts = pgTable(
  "parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull().unique(),
    oemPartNo: text("oem_part_no"),
    barcode: text("barcode").unique(),
    name: text("name").notNull(),
    /** Other names, supplier and cross-reference numbers; searched like the name. */
    keywords: text("keywords"),
    categoryId: uuid("category_id").references(() => categories.id),
    brandId: uuid("brand_id").references(() => brands.id),
    unit: text("unit").notNull().default("pcs"),
    binLocation: text("bin_location"),
    qtyOnHand: integer("qty_on_hand").notNull().default(0),
    avgCost: numeric("avg_cost", { precision: 12, scale: 2, mode: "string" })
      .notNull()
      .default("0.00"),
    reorderLevel: integer("reorder_level").notNull().default(0),
    reorderQty: integer("reorder_qty").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("parts_qty_on_hand_non_negative", sql`${t.qtyOnHand} >= 0`),
    check("parts_reorder_non_negative", sql`${t.reorderLevel} >= 0 and ${t.reorderQty} >= 0`),
    index("parts_oem_part_no_idx").on(t.oemPartNo),
  ],
);

export const partPrices = pgTable(
  "part_prices",
  {
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    tierId: uuid("tier_id")
      .notNull()
      .references(() => priceTiers.id),
    price: numeric("price", { precision: 12, scale: 2, mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.partId, t.tierId] }),
    check("part_prices_price_non_negative", sql`${t.price} >= 0`),
  ],
);

export const partFitments = pgTable(
  "part_fitments",
  {
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    vehicleModelId: uuid("vehicle_model_id")
      .notNull()
      .references(() => vehicleModels.id),
  },
  (t) => [
    primaryKey({ columns: [t.partId, t.vehicleModelId] }),
    index("part_fitments_vehicle_model_idx").on(t.vehicleModelId),
  ],
);
