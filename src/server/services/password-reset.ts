import { and, eq, sql } from "drizzle-orm";
import { passwordSchema } from "@/lib/password";
import {
  CODE_FAILED,
  checkCode,
  hashCode,
  makeCode,
  normaliseEmail,
  RESET_CODE_MINUTES,
  RESET_CODE_TRIES,
} from "@/lib/reset-code";
import { displayName } from "@/lib/business-name";
import { setPassword } from "@/server/auth-admin";
import { db } from "@/server/db/client";
import { passwordResetCodes, profiles } from "@/server/db/schema";
import { sendEmail as realSendEmail, type SendEmail } from "@/server/email";
import { findSettings } from "@/server/services/settings";
import { DAY, HOUR, takeLimit } from "@/server/rate-limit";

export const REQUESTS_PER_EMAIL_HOUR = 3;
export const REQUESTS_PER_EMAIL_DAY = 10;
export const REQUESTS_PER_DEVICE = 10;
export const TRIES_PER_DEVICE = 10;

export type ResetDeps = { send?: SendEmail; secret?: string };

function resetSecret(deps: ResetDeps): string {
  const secret = deps.secret ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return secret;
}

/** A login that may get a code: it exists, is turned on, and the admin ticked "Can get emails". */
async function findResettable(email: string) {
  const [user] = await db
    .select({ id: profiles.userId, email: profiles.email })
    .from(profiles)
    .where(and(eq(profiles.email, email), eq(profiles.isActive, true), eq(profiles.canGetEmails, true)));
  return user ?? null;
}

/** This company's name for email subjects (read fresh: services don't use the page cache). */
const companyName = async () => displayName((await findSettings())?.businessName);

const colomboDateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "short" }).format(d);

/**
 * Step 1. Sends a code to the login's own email when it may get one. Never throws and never says why
 * nothing was sent: the caller always shows the same answer, and runs this after replying.
 */
export async function requestResetCode(
  input: { email: string; ip: string; now?: Date },
  deps: ResetDeps = {},
): Promise<"sent" | "skipped"> {
  const now = input.now ?? new Date();
  const email = normaliseEmail(input.email);
  try {
    if (!(await takeLimit(`reset-ip/${input.ip}`, REQUESTS_PER_DEVICE, HOUR, now))) return "skipped";
    const user = await findResettable(email);
    if (!user) return "skipped";
    if (!(await takeLimit(`reset-email/${user.email}`, REQUESTS_PER_EMAIL_HOUR, HOUR, now))) return "skipped";
    if (!(await takeLimit(`reset-email-day/${user.email}`, REQUESTS_PER_EMAIL_DAY, DAY, now))) return "skipped";

    const code = makeCode();
    const row = {
      email: user.email,
      userId: user.id,
      codeHash: hashCode(code, resetSecret(deps)),
      tries: 0,
      expiresAt: new Date(now.getTime() + RESET_CODE_MINUTES * 60_000),
      createdAt: now,
    };
    // A new code replaces the old one: one live code per login.
    await db.insert(passwordResetCodes).values(row).onConflictDoUpdate({ target: passwordResetCodes.email, set: row });

    // Only ever to the email already on the login; the code stays out of the subject (lock screens).
    const sent = await (deps.send ?? realSendEmail)({
      to: user.email,
      subject: `Your ${await companyName()} password code`,
      text:
        `Your code is ${code}\n\n` +
        `Type it on the Forgot password page. It works for ${RESET_CODE_MINUTES} minutes, once.\n\n` +
        "If you did not ask for this, ignore this email. Your password stays the same.",
    });
    if (!sent.ok) {
      console.error("[password reset] code email not sent:", sent.error);
      return "skipped";
    }
    return "sent";
  } catch (error) {
    console.error("[password reset] asking for a code failed:", error);
    return "skipped";
  }
}

export type ResetResult = { ok: true } | { ok: false; field?: "newPassword" | "confirmPassword"; message: string };

/** Step 2. Checks the code and saves the new password. Every code problem gives the same answer. */
export async function resetWithCode(
  input: { email: string; code: string; newPassword: string; confirmPassword: string; ip: string; now?: Date },
  deps: ResetDeps = {},
): Promise<ResetResult> {
  const now = input.now ?? new Date();
  const email = normaliseEmail(input.email);

  // Password problems first, so fixing a short password doesn't cost a code try.
  const password = passwordSchema.safeParse(input.newPassword);
  if (!password.success) return { ok: false, field: "newPassword", message: password.error.issues[0].message };
  if (input.newPassword !== input.confirmPassword) {
    return { ok: false, field: "confirmPassword", message: "The two new passwords don't match" };
  }

  const failed = { ok: false as const, message: CODE_FAILED };
  try {
    if (!(await takeLimit(`reset-try/${input.ip}`, TRIES_PER_DEVICE, HOUR, now))) return failed;

    const [row] = await db.select().from(passwordResetCodes).where(eq(passwordResetCodes.email, email));
    const verdict = checkCode(row ?? null, input.code, resetSecret(deps), now);
    if (!row || verdict === "dead") {
      await db.delete(passwordResetCodes).where(eq(passwordResetCodes.email, email));
      return failed;
    }

    // Count the try before acting on the comparison. Only one of several tries sent at the same
    // moment can win this conditional update; the rest are turned away without being looked at.
    const won = await db
      .update(passwordResetCodes)
      .set({ tries: sql`${passwordResetCodes.tries} + 1` })
      .where(
        and(
          eq(passwordResetCodes.email, email),
          eq(passwordResetCodes.codeHash, row.codeHash),
          eq(passwordResetCodes.tries, row.tries),
        ),
      )
      .returning({ tries: passwordResetCodes.tries });
    if (won.length !== 1) return failed;
    if (verdict === "wrong") {
      if (won[0].tries >= RESET_CODE_TRIES) {
        await db.delete(passwordResetCodes).where(eq(passwordResetCodes.email, email));
      }
      return failed;
    }

    // The login must still be allowed, and still be the one the code was sent for.
    const user = await findResettable(email);
    if (!user || user.id !== row.userId) {
      await db.delete(passwordResetCodes).where(eq(passwordResetCodes.email, email));
      return failed;
    }

    const saved = await db.transaction(async (tx) => {
      // Spend the code in the same transaction; two submits of one code can't both get here.
      const used = await tx
        .delete(passwordResetCodes)
        .where(and(eq(passwordResetCodes.email, email), eq(passwordResetCodes.codeHash, row.codeHash)))
        .returning({ email: passwordResetCodes.email });
      if (used.length !== 1) return false;
      // New password, and every device this login is signed in on is signed out.
      await setPassword(user.id, input.newPassword, tx);
      return true;
    });
    if (!saved) return failed;

    // A notice that fails to send never undoes the reset.
    const notice = await (deps.send ?? realSendEmail)({
      to: user.email,
      subject: `Your ${await companyName()} password was changed`,
      text:
        `Your password was changed on ${colomboDateTime(now)} using a code sent to this email.\n\n` +
        "If this wasn't you, tell the admin at once.",
    }).catch(() => ({ ok: false as const, error: "threw" }));
    if (!notice.ok) console.error("[password reset] changed-password notice not sent:", notice.error);
    return { ok: true };
  } catch (error) {
    console.error("[password reset] checking a code failed:", error);
    return failed;
  }
}
