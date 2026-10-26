import { sql } from "drizzle-orm";
import { colomboYear } from "@/lib/dates";
import type { Tx } from "@/server/db/client";
import { documentSequences, settings } from "@/server/db/schema";

export type DocType = "INV" | "GRN" | "CRN" | "PAY" | "ADJ" | "QUO";

/**
 * Issues the next gapless document number, e.g. `INV-2026-000123` (or `SP-INV-…` with a prefix).
 * The upsert locks the (doc_type, year) row until the caller's transaction ends, so a rolled-back
 * transaction gives its number back. `next_no` holds the last number issued.
 */
export async function nextNumber(tx: Tx, docType: DocType, at: Date = new Date()): Promise<string> {
  const year = colomboYear(at);
  const [row] = await tx
    .insert(documentSequences)
    .values({ docType, year, nextNo: 1 })
    .onConflictDoUpdate({
      target: [documentSequences.docType, documentSequences.year],
      set: { nextNo: sql`${documentSequences.nextNo} + 1` },
    })
    .returning({ no: documentSequences.nextNo });

  const [s] = await tx.select({ prefix: settings.docPrefix }).from(settings);
  const base = `${docType}-${year}-${String(row.no).padStart(6, "0")}`;
  return s?.prefix ? `${s.prefix}-${base}` : base;
}
