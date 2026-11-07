import { z } from "zod";

/** Supabase stores passwords with bcrypt, which reads only the first 72 bytes, so longer ones are refused. */
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "Use at most 72 characters");
