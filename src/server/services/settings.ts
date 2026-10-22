import { eq } from "drizzle-orm";
import { z } from "zod";
import { D, fmt } from "@/lib/money";
import { requireRole, type SessionUser } from "@/server/auth";
import { db, type Executor } from "@/server/db/client";
import { settings } from "@/server/db/schema";

export type Settings = typeof settings.$inferSelect;

/** The single settings row (seeded by insertBaseData). */
export async function getSettings(tx: Executor = db): Promise<Settings> {
  const [row] = await tx.select().from(settings);
  if (!row) throw new Error("Settings row missing; run pnpm db:seed");
  return row;
}

const percent = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, `Enter ${label} like 18 or 12.5`)
    .refine((v) => D(v).lessThanOrEqualTo(100), `${label} can't be more than 100%`)
    .transform((v) => fmt(D(v)));

export const settingsInputSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(120),
  address: z.string().trim().max(300),
  phone: z.string().trim().max(60),
  email: z.union([z.email("Enter a valid email"), z.literal("")]),
  tin: z.string().trim().max(40),
  vatEnabled: z.boolean(),
  vatRate: percent("VAT rate"),
  staffMaxDiscountPct: percent("The staff discount limit"),
  defaultCreditDays: z.coerce.number().int().min(0).max(365),
  docPrefix: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{0,6}$/, "Use up to 6 capital letters or digits"),
  logoUrl: z.url().nullish(),
});

export type SettingsInput = z.input<typeof settingsInputSchema>;

export async function updateSettings(user: SessionUser, input: SettingsInput): Promise<void> {
  requireRole(user, "admin");
  const data = settingsInputSchema.parse(input);
  await db
    .update(settings)
    .set({ ...data, logoUrl: data.logoUrl === undefined ? undefined : data.logoUrl, updatedAt: new Date() })
    .where(eq(settings.id, 1));
}
