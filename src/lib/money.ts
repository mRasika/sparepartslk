import Decimal from "decimal.js";

/** Decimal configured for money: plenty of precision, half-up rounding. */
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type { Decimal };

export function D(x: string | number | Decimal): Decimal {
  return new Money(x);
}

export function round2(x: Decimal): Decimal {
  return new Money(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** 2-decimal string for numeric(12,2) columns. */
export function fmt(x: Decimal): string {
  return round2(x).toFixed(2);
}

export function sum(xs: Decimal[]): Decimal {
  return xs.reduce<Decimal>((acc, x) => acc.plus(x), new Money(0));
}
