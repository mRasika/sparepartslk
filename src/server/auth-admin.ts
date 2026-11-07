import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hashPassword } from "@/lib/password-hash";
import { normaliseEmail } from "@/lib/reset-code";
import type { Role } from "@/server/auth";
import { db, type Executor } from "@/server/db/client";
import { account, profiles, session, user } from "@/server/db/schema";
import { DomainError, NotFound } from "@/server/errors";

/**
 * Direct writes to Better Auth's tables, so logins, passwords and sessions change inside our own
 * transactions. Pass a transaction as `ex` to join it (nested calls become savepoints).
 */

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.cause?.code ?? err.code) === "23505";
}

/** Creates the user, its password (credential account) and the profile together. */
export async function createLogin(
  input: { id?: string; email: string; name: string; password: string; role: Role; canGetEmails?: boolean },
  ex: Executor = db,
): Promise<{ id: string }> {
  const id = input.id ?? randomUUID();
  const email = normaliseEmail(input.email);
  const password = await hashPassword(input.password);
  try {
    await ex.transaction(async (tx) => {
      await tx.insert(user).values({ id, email, name: input.name, emailVerified: true });
      await tx.insert(account).values({ accountId: id, providerId: "credential", userId: id, password });
      await tx.insert(profiles).values({
        userId: id,
        email,
        fullName: input.name,
        role: input.role,
        canGetEmails: input.canGetEmails ?? false,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("Duplicate", `${email} already has an account`, { field: "email" });
    throw e;
  }
  return { id };
}

/** New password for the login; every device it is signed in on is signed out. */
export async function setPassword(userId: string, password: string, ex: Executor = db): Promise<void> {
  const hash = await hashPassword(password);
  await ex.transaction(async (tx) => {
    const updated = await tx
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (updated.length === 0) throw new NotFound("User not found");
    await tx.delete(session).where(eq(session.userId, userId));
  });
}

/** Signs the login out on every device (takes effect on its next request). */
export async function endSessions(userId: string, ex: Executor = db): Promise<void> {
  await ex.delete(session).where(eq(session.userId, userId));
}
