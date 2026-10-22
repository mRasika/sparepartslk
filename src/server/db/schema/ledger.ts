import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { parts } from "./catalog";
import { audit, money } from "./columns";
import { docTypeEnum, movementTypeEnum } from "./reference";

/** Append-only. The app never updates or deletes rows. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    type: movementTypeEnum("type").notNull(),
    qtyChange: integer("qty_change").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    unitCost: money("unit_cost").notNull(),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id"),
    ...audit(),
  },
  (t) => [index("stock_movements_part_created_idx").on(t.partId, t.createdAt)],
);

export const documentSequences = pgTable(
  "document_sequences",
  {
    docType: docTypeEnum("doc_type").notNull(),
    year: integer("year").notNull(),
    nextNo: integer("next_no").notNull(),
  },
  (t) => [primaryKey({ columns: [t.docType, t.year] })],
);

export const stockReconciliationIssues = pgTable(
  "stock_reconciliation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    storedQty: integer("stored_qty").notNull(),
    ledgerQty: integer("ledger_qty").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("stock_reconciliation_issues_part_idx").on(t.partId)],
);
