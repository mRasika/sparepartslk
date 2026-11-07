import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";
import { createSupabaseServerClient } from "@/server/supabase";

export type Role = "admin" | "staff";

export type SessionUser = { id: string; email: string; fullName: string; role: Role };

/**
 * The profile for a user id, or null when it is missing or deactivated. With `signedInAt` (seconds,
 * from the session token), also null when that session started before the password last changed.
 */
export async function loadActiveUser(userId: string, signedInAt?: number): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: profiles.userId,
      email: profiles.email,
      fullName: profiles.fullName,
      role: profiles.role,
      signedOutAt: profiles.signedOutAt,
    })
    .from(profiles)
    .where(and(eq(profiles.userId, userId), eq(profiles.isActive, true)));
  if (!row) return null;
  const { signedOutAt, ...user } = row;
  if (signedInAt !== undefined && signedOutAt && signedInAt * 1000 < signedOutAt.getTime()) return null;
  return user;
}

/**
 * When this session first signed in, in seconds. Supabase keeps the sign-in time in `amr` across
 * token refreshes (`iat` changes on every refresh), so a refreshed old session is still caught.
 */
export function sessionSignedInAt(claims: { iat?: number; amr?: unknown }): number {
  const times = Array.isArray(claims.amr)
    ? claims.amr.map((a: { timestamp?: unknown }) => a?.timestamp).filter((t): t is number => typeof t === "number")
    : [];
  return times.length ? Math.min(...times) : (claims.iat ?? 0);
}

/**
 * The signed-in, active user for this request (memoised per request). The JWT is verified locally
 * (asymmetric signing keys), so a revoked session lasts until the token expires; deactivated users,
 * and sessions older than the last password change, are still cut off at once by the profile check.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  return loadActiveUser(data.claims.sub, sessionSignedInAt(data.claims));
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
