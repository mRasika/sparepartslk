import { and, eq, inArray, or } from "drizzle-orm";
import type Decimal from "decimal.js";
import { D, fmt, round2, sum } from "@/lib/money";
import type { SessionUser } from "@/server/auth";
import type { Executor } from "@/server/db/client";
import { partPrices, parts, priceTiers } from "@/server/db/schema";
import { DiscountNotAllowed, PriceMissing } from "@/server/errors";

export type DiscountInput = { type: "amount" | "percent"; value: string };

export type PricedLineInput = { partId: string; qty: number; unitPrice: string; discount?: DiscountInput };

export type Totals = {
  lines: { gross: string; discount: string; lineTotal: string }[];
  subtotal: string;
  invoiceDiscount: string;
  vatAmount: string;
  total: string;
};

/**
 * Unit price per part for a tier: the tier's own price, else the default tier's price.
 * A part with neither raises PriceMissing — it is never priced at 0.
 */
export async function resolvePrices(
  tx: Executor,
  tierId: string,
  partIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(partIds)];
  if (ids.length === 0) return new Map();

  const [defaultTier] = await tx.select({ id: priceTiers.id }).from(priceTiers).where(eq(priceTiers.isDefault, true));
  const rows = await tx
    .select({ partId: partPrices.partId, tierId: partPrices.tierId, price: partPrices.price })
    .from(partPrices)
    .where(
      and(
        inArray(partPrices.partId, ids),
        or(eq(partPrices.tierId, tierId), defaultTier ? eq(partPrices.tierId, defaultTier.id) : undefined),
      ),
    );

  const result = new Map<string, string>();
  const missing: string[] = [];
  for (const id of ids) {
    const own = rows.find((r) => r.partId === id && r.tierId === tierId);
    const fallback = rows.find((r) => r.partId === id && r.tierId === defaultTier?.id);
    const price = own?.price ?? fallback?.price;
    if (price === undefined) missing.push(id);
    else result.set(id, price);
  }
  if (missing.length) {
    const [part] = await tx.select({ id: parts.id, sku: parts.sku }).from(parts).where(eq(parts.id, missing[0]));
    throw new PriceMissing({ partId: missing[0], sku: part?.sku ?? missing[0] });
  }
  return result;
}

function discountAmount(base: Decimal, discount: DiscountInput | undefined, what: string): Decimal {
  if (!discount || discount.value.trim() === "") return D(0);
  const value = D(discount.value);
  if (value.isNegative()) throw new DiscountNotAllowed(`The ${what} discount can't be negative`);
  const amount = discount.type === "percent" ? round2(base.times(value).div(100)) : round2(value);
  if (amount.greaterThan(base)) {
    throw new DiscountNotAllowed(`The ${what} discount is more than the ${what} amount`);
  }
  return amount;
}

/**
 * Invoice arithmetic (spec §5.1 step 6), rounding half-up to 2 decimals at every line and total:
 * line = qty × price − discount; VAT on (subtotal − invoice discount); total = the parts summed exactly.
 */
export function computeTotals(
  lines: PricedLineInput[],
  invoiceDiscount: DiscountInput | undefined,
  vatRate: string,
): Totals {
  const computed = lines.map((l) => {
    const gross = round2(D(l.qty).times(l.unitPrice));
    const discount = discountAmount(gross, l.discount, "line");
    return { gross, discount, lineTotal: round2(gross.minus(discount)) };
  });
  const subtotal = sum(computed.map((c) => c.lineTotal));
  const invDiscount = discountAmount(subtotal, invoiceDiscount, "invoice");
  const taxable = subtotal.minus(invDiscount);
  const vatAmount = round2(taxable.times(vatRate).div(100));
  return {
    lines: computed.map((c) => ({ gross: fmt(c.gross), discount: fmt(c.discount), lineTotal: fmt(c.lineTotal) })),
    subtotal: fmt(subtotal),
    invoiceDiscount: fmt(invDiscount),
    vatAmount: fmt(vatAmount),
    total: fmt(taxable.plus(vatAmount)),
  };
}

/** Staff discounts are capped at `capPct` of each line and of the subtotal; admins are not capped. */
export function assertDiscountAllowed(user: SessionUser, totals: Totals, capPct: string): void {
  if (user.role === "admin") return;
  const cap = (base: string) => round2(D(base).times(capPct).div(100));
  totals.lines.forEach((l, i) => {
    if (D(l.discount).greaterThan(cap(l.gross))) {
      throw new DiscountNotAllowed(`Line ${i + 1}: staff can give at most ${capPct}% discount`, { line: i, capPct });
    }
  });
  if (D(totals.invoiceDiscount).greaterThan(cap(totals.subtotal))) {
    throw new DiscountNotAllowed(`Staff can give at most ${capPct}% invoice discount`, { capPct });
  }
}
