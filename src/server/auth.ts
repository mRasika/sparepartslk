import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";
import { createSupabaseServerClient } from "@/server/supabase";

export type Role = "admin" | "staff";

export type SessionUser = { id: string; email: string; fullName: string; role: Role };

/** The profile for a user id, or null when it is missing or deactivated. */
export async function loadActiveUser(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: profiles.userId,
      email: profiles.email,
      fullName: profiles.fullName,
      role: profiles.role,
    })
    .from(profiles)
    .where(and(eq(profiles.userId, userId), eq(profiles.isActive, true)));
  return row ?? null;
}

/** The signed-in, active user for this request (memoised per request). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return loadActiveUser(data.user.id);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Forbidden("Please sign in again");
  return user;
}

export function requireRole(user: SessionUser, role: Role): void {
  if (role === "admin" && user.role !== "admin") {
    throw new Forbidden("Only an admin can do this");
  }
}
