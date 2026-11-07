import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { passwordSchema } from "@/lib/password";
import { requireRole, type Role, type SessionUser } from "@/server/auth";
import { createLogin, endSessions, setPassword } from "@/server/auth-admin";
import { db } from "@/server/db/client";
import { passwordResetCodes, profiles } from "@/server/db/schema";
import { DomainError, InvalidState, NotFound } from "@/server/errors";

export const newUserSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(1, "Name is required").max(80),
  role: z.enum(["admin", "staff"]),
  password: passwordSchema,
  canGetEmails: z.boolean().default(false),
});

export type NewUserInput = z.input<typeof newUserSchema>;

export async function listUsers() {
  return db
    .select({
      id: profiles.userId,
      email: profiles.email,
      fullName: profiles.fullName,
      role: profiles.role,
      isActive: profiles.isActive,
      canGetEmails: profiles.canGetEmails,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .orderBy(asc(profiles.fullName));
}

/** Creates the login (password, ready to use) and the matching profile together. Admin only. */
export async function createUser(user: SessionUser, input: NewUserInput): Promise<{ id: string }> {
  requireRole(user, "admin");
  const data = newUserSchema.parse(input);
  const [existing] = await db.select().from(profiles).where(eq(profiles.email, data.email));
  if (existing) throw new DomainError("Duplicate", `${data.email} already has an account`, { field: "email" });

  return createLogin({
    email: data.email,
    name: data.fullName,
    password: data.password,
    role: data.role,
    canGetEmails: data.canGetEmails,
  });
}

async function otherActiveAdmins(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(profiles)
    .where(and(eq(profiles.role, "admin"), eq(profiles.isActive, true), ne(profiles.userId, userId)));
  return row.n;
}

/**
 * Turns a login on or off. Turning it off also signs it out on every device. An admin can't turn
 * themself off (so there is always someone in charge).
 */
export async function setUserActive(user: SessionUser, userId: string, active: boolean): Promise<void> {
  requireRole(user, "admin");
  if (!active && userId === user.id) throw new InvalidState("You can't turn off your own account");
  const [target] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!target) throw new NotFound("User not found");
  if (!active && target.role === "admin" && (await otherActiveAdmins(userId)) === 0) {
    throw new InvalidState("At least one active admin is needed");
  }
  await db.transaction(async (tx) => {
    await tx.update(profiles).set({ isActive: active }).where(eq(profiles.userId, userId));
    if (!active) await endSessions(userId, tx);
  });
}

/** Changes a user's role. The last active admin can't be demoted. */
export async function setUserRole(user: SessionUser, userId: string, role: Role): Promise<void> {
  requireRole(user, "admin");
  const [target] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!target) throw new NotFound("User not found");
  if (target.role === "admin" && role !== "admin" && target.isActive && (await otherActiveAdmins(userId)) === 0) {
    throw new InvalidState("At least one active admin is needed");
  }
  await db.update(profiles).set({ role }).where(eq(profiles.userId, userId));
}

/**
 * The admin's tick that this login's email is read only by that person, so "Forgot password?" may
 * send a code to it. Turning it off also throws away any code already sent.
 */
export async function setCanGetEmails(user: SessionUser, userId: string, on: boolean): Promise<void> {
  requireRole(user, "admin");
  const updated = await db
    .update(profiles)
    .set({ canGetEmails: on })
    .where(eq(profiles.userId, userId))
    .returning({ id: profiles.userId });
  if (updated.length === 0) throw new NotFound("User not found");
  if (!on) await db.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, userId));
}

/**
 * Admin sets a new password for a login (works with or without email). That login is signed out on
 * every device, and any password code already sent is thrown away.
 */
export async function setUserPassword(
  user: SessionUser,
  userId: string,
  password: string,
): Promise<void> {
  requireRole(user, "admin");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new DomainError("Validation", parsed.error.issues[0].message, { field: "password" });
  const [target] = await db.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, userId));
  if (!target) throw new NotFound("User not found");

  await db.transaction(async (tx) => {
    await tx.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, userId));
    await setPassword(userId, password, tx);
  });
}
