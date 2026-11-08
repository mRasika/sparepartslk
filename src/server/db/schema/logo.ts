import { sql } from "drizzle-orm";
import { check, customType, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/** Postgres bytea, read and written as a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * The company's logo (at most one row, id 1). Kept out of `settings` so the cached settings never
 * carry the picture; served by /api/logo, and backed up with the rest of the database.
 */
export const logo = pgTable(
  "logo",
  {
    id: smallint("id").primaryKey().default(1),
    contentType: text("content_type").notNull(),
    data: bytea("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("logo_single_row", sql`${t.id} = 1`)],
);
