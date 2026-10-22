import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { requireRole, type Role, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { DomainError, InvalidState, NotFound } from "@/server/errors";
import { createSupabaseAdminClient } from "@/server/supabase";

/** The slice of Supabase's auth admin API we use; tests pass a fake. */
export type AuthAdmin = {
  createUser(args: { email: string; password: string; email_confirm: boolean }): Promise<{
    data: { user: { id: string } | null };
    error: { message: string } | null;
  }>;
};

export const newUserSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(1, "Name is required").max(80),
  role: z.enum(["admin", "staff"]),
  password: z.string().min(8, "Use at least 8 characters").max(72),
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
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .orderBy(asc(profiles.fullName));
}

/** Creates the Supabase login (already confirmed) and the matching profile. Admin only. */
export async function createUser(
  user: SessionUser,
  input: NewUserInput,
  deps: { authAdmin?: AuthAdmin } = {},
): Promise<{ id: string }> {
  requireRole(user, "admin");
  const data = newUserSchema.parse(input);
  const [existing] = await db.select().from(profiles).where(eq(profiles.email, data.email));
  if (existing) throw new DomainError("Duplicate", `${data.email} already has an account`, { field: "email" });

  const authAdmin = deps.authAdmin ?? createSupabaseAdminClient().auth.admin;
  const { data: created, error } = await authAdmin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
  });
  if (error || !created.user) {
    throw new DomainError("AuthError", error?.message ?? "Could not create the login", { field: "email" });
  }
  await db.insert(profiles).values({
    userId: created.user.id,
    email: data.email,
    fullName: data.fullName,
    role: data.role,
  });
  return { id: created.user.id };
}

async function otherActiveAdmins(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(profiles)
    .where(and(eq(profiles.role, "admin"), eq(profiles.isActive, true), ne(profiles.userId, userId)));
  return row.n;
}

/** Turns a login on or off. An admin can't turn themself off (so there is always someone in charge). */
export async function setUserActive(user: SessionUser, userId: string, active: boolean): Promise<void> {
  requireRole(user, "admin");
  if (!active && userId === user.id) throw new InvalidState("You can't turn off your own account");
  const [target] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!target) throw new NotFound("User not found");
  if (!active && target.role === "admin" && (await otherActiveAdmins(userId)) === 0) {
    throw new InvalidState("At least one active admin is needed");
  }
  await db.update(profiles).set({ isActive: active }).where(eq(profiles.userId, userId));
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
