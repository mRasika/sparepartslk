/** Label-roll sizes the label page prints, in mm (width × height). */
export const LABEL_SIZES = {
  "50x25": { width: 50, height: 25, label: "50 × 25 mm" },
  "40x30": { width: 40, height: 30, label: "40 × 30 mm" },
  "38x25": { width: 38, height: 25, label: "38 × 25 mm" },
} as const;

export type LabelSize = keyof typeof LABEL_SIZES;

export const DEFAULT_LABEL_SIZE: LabelSize = "50x25";

/** Blank space each side of the bars, which scanners need to find the barcode. */
export const QUIET_ZONE_MM = 2;

/** Bars thinner than this may not scan with a cheap scanner. */
const MIN_BAR_MM = 0.19;

const MAX_LABELS = 999;

export function isLabelSize(v: unknown): v is LabelSize {
  return typeof v === "string" && Object.hasOwn(LABEL_SIZES, v);
}

/** Code 128 holds printable ASCII only (space to ~). */
export function isEncodableSku(sku: string): boolean {
  return /^[\x20-\x7E]+$/.test(sku);
}

/** The width of one bar (module) when the barcode fills the label between its quiet zones. */
export function barWidthMm(modules: number, size: LabelSize): number {
  return (LABEL_SIZES[size].width - 2 * QUIET_ZONE_MM) / modules;
}

/** Why a SKU's label would not work at this size, if it would not. */
export function labelProblem(sku: string, modules: number | null, size: LabelSize): "unencodable" | "too-long" | null {
  if (!isEncodableSku(sku) || !modules) return "unencodable";
  return barWidthMm(modules, size) < MIN_BAR_MM ? "too-long" : null;
}

/** A label count as a whole number from 0 to 999; anything else counts as 0. */
export function clampLabelCount(v: string | number): number {
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return 0;
  return Math.min(Number(s), MAX_LABELS);
}

/** More labels than this in one print asks first: a GRN of bulk parts can default to hundreds. */
const LARGE_PRINT = 50;

/** The question to ask before printing this many labels, or null when it's a normal amount. */
export function printConfirmText(count: number): string | null {
  return count > LARGE_PRINT ? `Print ${count} labels?` : null;
}
