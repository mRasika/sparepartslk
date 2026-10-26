import type { DiscountState } from "./totals-panel";

/** Input checks shared by the invoice and quotation editors. */
export const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;
export const validQty = (q: string) => /^\d+$/.test(q.trim()) && Number(q) > 0;
export const discountOrUndefined = (d: DiscountState) =>
  d.value.trim() === "" || Number(d.value) === 0 ? undefined : { type: d.type, value: d.value.trim() };
export const validDiscount = (d: DiscountState) => d.value.trim() === "" || AMOUNT.test(d.value.trim());
