import { createHash, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { passwordSchema } from "@/lib/password";
import { normaliseEmail } from "@/lib/reset-code";
import { createLogin } from "@/server/auth-admin";
import { insertBaseData } from "@/server/db/base-data";
import { db, type Executor } from "@/server/db/client";
import { profiles, settings } from "@/server/db/schema";
import { HOUR, takeLimit } from "@/server/rate-limit";

export const SETUP_KEY_MIN = 24;
/** A fixed number used only for setup's advisory lock, so two setups can't run side by side. */
export const SETUP_LOCK_ID = 72026110;
export const SETUP_TRIES_PER_DEVICE = 10;

const LOCKED = "Setup is locked. Put a SETUP_KEY of at least 24 characters in the stack settings, then reload this page.";
const ALREADY = "This system is already set up. Sign in instead.";

/** True once this database has a company: at least one login profile. */
export async function companyExists(ex: Executor = db): Promise<boolean> {
  const rows = await ex.select({ one: sql`1` }).from(profiles).limit(1);
  return rows.length > 0;
}

/** Whether the stack settings hold a usable setup key (24+ characters, spaces around it ignored). */
export function setupKeyState(key = process.env.SETUP_KEY): "missing" | "ready" {
  return (key?.trim().length ?? 0) >= SETUP_KEY_MIN ? "ready" : "missing";
}

export const setupSchema = z
  .object({
    setupKey: z.string(),
    businessName: z.string().trim().min(1, "Enter the business name").max(80),
    ownerName: z.string().trim().min(1, "Enter your name").max(80),
    email: z.string().trim().pipe(z.email("Enter a valid email address")),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords don't match",
  });

export type SetupInput = z.input<typeof setupSchema>;
export type SetupResult = { ok: true; userId: string; email: string } | { ok: false; field?: string; message: string };

/** Compares hashes of both keys in constant time, so the time taken says nothing about the key. */
function sameKey(typed: string, expected: string): boolean {
  const hash = (v: string) => createHash("sha256").update(v.trim()).digest();
  return timingSafeEqual(hash(typed), hash(expected));
}

/**
 * Sets up a new company on an empty database: base data, the business name and the owner's admin
 * login, in one transaction. Needs the setup key from the stack settings. Runs only once: an
 * advisory lock makes same-moment submits wait, and each re-checks that no company exists yet.
 */
export async function setupCompany(
  input: SetupInput,
  ctx: { ip: string },
  deps: { setupKey?: string } = { setupKey: process.env.SETUP_KEY },
): Promise<SetupResult> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, field: String(issue.path[0] ?? ""), message: issue.message };
  }
  const data = parsed.data;

  if (!(await takeLimit(`setup-ip/${ctx.ip}`, SETUP_TRIES_PER_DEVICE, HOUR))) {
    return { ok: false, message: "Too many tries. Wait a while and try again." };
  }
  if (setupKeyState(deps.setupKey) === "missing") return { ok: false, message: LOCKED };
  if (!sameKey(data.setupKey, deps.setupKey!)) {
    return { ok: false, field: "setupKey", message: "The setup key is wrong." };
  }

  const email = normaliseEmail(data.email);
  const userId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_ID})`);
    if (await companyExists(tx)) return null;
    await insertBaseData(tx);
    await tx.update(settings).set({ businessName: data.businessName, updatedAt: new Date() }).where(eq(settings.id, 1));
    const { id } = await createLogin({ email, name: data.ownerName, password: data.password, role: "admin" }, tx);
    return id;
  });
  if (!userId) return { ok: false, message: ALREADY };
  return { ok: true, userId, email };
}
