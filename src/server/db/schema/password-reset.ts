import { integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * At most one live password code per login email. Only an HMAC of the code is kept, never the code.
 * Keyed by the normalised email so checking a code does the same work for every email typed.
 */
export const passwordResetCodes = pgTable("password_reset_codes", {
  email: text("email").primaryKey(),
  userId: uuid("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  tries: smallint("tries").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Fixed-window counters shared by every server instance (one row per key, e.g. "reset-email/a@b.lk"). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});
