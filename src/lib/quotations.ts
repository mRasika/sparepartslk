/** Days a quotation stays valid when nobody sets a date. */
export const QUOTE_VALID_DAYS = 14;

export type QuotationStatus = "open" | "expired" | "converted" | "cancelled";

/** "Expired" isn't stored: an open quotation past its valid-until date reads as expired. */
export function quotationStatus(
  stored: "open" | "converted" | "cancelled",
  validUntil: string,
  today: string,
): QuotationStatus {
  if (stored === "open" && validUntil < today) return "expired";
  return stored;
}

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  open: "Open",
  expired: "Expired",
  converted: "Converted",
  cancelled: "Cancelled",
};
