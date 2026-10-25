import { D, fmt } from "@/lib/money";

/** Rounding choices for tier rules and bulk price changes (rupees; 0 keeps cents). */
export const ROUND_TO_OPTIONS = [0, 1, 5, 10, 50, 100] as const;

/** Rounds half-up to the nearest multiple of `roundTo` rupees; 0 rounds to cents. */
export function roundPrice(price: string, roundTo: number): string {
  if (roundTo <= 0) return fmt(D(price));
  return fmt(D(price).div(roundTo).toDecimalPlaces(0).times(roundTo));
}

/**
 * A tier's rule price for a part with no typed price: the default tier's price less `discountPct`
 * percent (negative raises it), rounded. Keep in step with `ruleSql` in services/pricing.ts.
 */
export function rulePrice(basePrice: string, discountPct: string, roundTo: number): string {
  return roundPrice(D(basePrice).times(D(100).minus(discountPct)).div(100).toString(), roundTo);
}

/** "Retail −10%, nearest Rs 10" style label for a rule. */
export function describeRule(defaultTierName: string, discountPct: string, roundTo: number): string {
  const pct = Number(discountPct);
  if (!Number.isFinite(pct)) return "";
  const change = pct === 0 ? `same as ${defaultTierName}` : `${defaultTierName} ${pct > 0 ? "−" : "+"}${Math.abs(pct)}%`;
  return roundTo > 0 ? `${change}, nearest Rs ${roundTo}` : change;
}
