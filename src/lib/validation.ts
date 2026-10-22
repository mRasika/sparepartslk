import { z } from "zod";
import { D, fmt } from "@/lib/money";

/** A non-negative amount with up to 2 decimals, normalised to "1250.00". */
export const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an amount like 1250.00")
  .transform((v) => fmt(D(v)));

/** Optional free text; blank becomes null. */
export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Optional id from a select; blank becomes null. */
export const optionalId = z
  .union([z.uuid(), z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));
