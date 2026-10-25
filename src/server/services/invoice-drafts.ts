import { desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers, invoiceDrafts, parts, profiles } from "@/server/db/schema";
import { getCustomer, type CustomerRow } from "@/server/services/customers";
import { invoiceInputSchema, previewInvoice, type InvoiceInput } from "@/server/services/invoicing";
import { lookupPrices } from "@/server/services/pricing";

/** Drafts nobody has touched for this long are deleted the next time the list is read. */
const DRAFT_TTL = sql`interval '7 days'`;

const draftSchema = invoiceInputSchema.omit({ invoiceDate: true, overrideCreditLimit: true, draftId: true });

/**
 * Upserts the editor's draft. Input that doesn't parse (half-typed) is skipped, so the last good
 * state stays saved. `total` is the previewed total, or null when the preview failed.
 */
async function saveInvoiceDraft(user: SessionUser, id: string, input: InvoiceInput, total: string | null) {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(id).success) return;
  const { customerId, paymentType, ...data } = parsed.data;
  const values = { customerId, paymentType, data, lineCount: data.lines.length, total, updatedBy: user.id };
  await db
    .insert(invoiceDrafts)
    .values({ id, ...values, createdBy: user.id })
    .onConflictDoUpdate({ target: invoiceDrafts.id, set: { ...values, updatedAt: sql`now()` } });
}

/**
 * The editor's live preview, which also auto-saves the draft: one round trip per change. The draft
 * is saved even when the preview fails (no price, discount over the cap), then the error is raised.
 */
export async function previewAndSaveDraft(user: SessionUser, input: InvoiceInput, draftId: string) {
  let preview: Awaited<ReturnType<typeof previewInvoice>>;
  try {
    preview = await previewInvoice(user, input);
  } catch (e) {
    await saveInvoiceDraft(user, draftId, input, null);
    throw e;
  }
  await saveInvoiceDraft(user, draftId, input, preview.total);
  return preview;
}

export async function discardInvoiceDraft(_user: SessionUser, id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  await db.delete(invoiceDrafts).where(eq(invoiceDrafts.id, id));
}

export type InvoiceDraftRow = {
  id: string;
  customerName: string;
  lineCount: number;
  total: string | null;
  updatedAt: Date;
  updatedByName: string;
};

/** Open drafts, newest first. Clears out stale ones on the way. */
export async function listInvoiceDrafts(opts: { excludeId?: string } = {}): Promise<InvoiceDraftRow[]> {
  await db.delete(invoiceDrafts).where(lt(invoiceDrafts.updatedAt, sql`now() - ${DRAFT_TTL}`));
  const updater = alias(profiles, "updater");
  const exclude = opts.excludeId && z.uuid().safeParse(opts.excludeId).success ? opts.excludeId : undefined;
  return db
    .select({
      id: invoiceDrafts.id,
      customerName: customers.name,
      lineCount: invoiceDrafts.lineCount,
      total: invoiceDrafts.total,
      updatedAt: invoiceDrafts.updatedAt,
      updatedByName: updater.fullName,
    })
    .from(invoiceDrafts)
    .innerJoin(customers, eq(customers.id, invoiceDrafts.customerId))
    .innerJoin(updater, eq(updater.userId, invoiceDrafts.updatedBy))
    .where(exclude ? ne(invoiceDrafts.id, exclude) : undefined)
    .orderBy(desc(invoiceDrafts.updatedAt))
    .limit(20);
}

export async function countInvoiceDrafts(): Promise<number> {
  return db.$count(invoiceDrafts, gte(invoiceDrafts.updatedAt, sql`now() - ${DRAFT_TTL}`));
}

export type EditorDraft = {
  id: string;
  customer: CustomerRow;
  paymentType: "cash" | "credit";
  lines: {
    part: { id: string; sku: string; name: string; oemPartNo: string | null; qtyOnHand: number; unit: string; price?: string };
    qty: number;
    discount?: { type: "amount" | "percent"; value: string };
  }[];
  invoiceDiscount?: { type: "amount" | "percent"; value: string };
  cashPayment?: { method: "cash" | "bank" | "cheque"; reference?: string };
};

/** A draft ready to reopen in the editor: today's stock and the customer's current prices. */
export async function getInvoiceDraftForEditor(id: string): Promise<EditorDraft | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [draft] = await db.select().from(invoiceDrafts).where(eq(invoiceDrafts.id, id));
  if (!draft) return null;

  const customer = await getCustomer(draft.customerId);
  const partIds = draft.data.lines.map((l) => l.partId);
  const [partRows, prices] = await Promise.all([
    partIds.length
      ? db
          .select({
            id: parts.id,
            sku: parts.sku,
            name: parts.name,
            oemPartNo: parts.oemPartNo,
            qtyOnHand: parts.qtyOnHand,
            unit: parts.unit,
          })
          .from(parts)
          .where(inArray(parts.id, partIds))
      : [],
    lookupPrices(db, customer.tierId, partIds),
  ]);
  const byId = new Map(partRows.map((p) => [p.id, p]));

  return {
    id: draft.id,
    customer,
    paymentType: draft.paymentType,
    lines: draft.data.lines
      .filter((l) => byId.has(l.partId))
      .map((l) => ({ part: { ...byId.get(l.partId)!, price: prices.get(l.partId) }, qty: l.qty, discount: l.discount })),
    invoiceDiscount: draft.data.invoiceDiscount,
    cashPayment: draft.data.cashPayment,
  };
}
