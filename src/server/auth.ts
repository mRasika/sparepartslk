import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/server/better-auth";
import { db } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";

export type Role = "admin" | "staff";

export type SessionUser = { id: string; email: string; fullName: string; role: Role };

/** The profile for a user id, or null when it is missing or turned off. */
export async function loadActiveUser(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ id: profiles.userId, email: profiles.email, fullName: profiles.fullName, role: profiles.role })
    .from(profiles)
    .where(and(eq(profiles.userId, userId), eq(profiles.isActive, true)));
  return row ?? null;
}

/**
 * The signed-in, active user for these request headers. Every call reads the session row (the
 * cookie cache is skipped), so signing out, Set password and turning a login off take effect on
 * the next request. It never renews the session: a page render can't set the cookie, so the daily
 * renewal is left to the middleware, which passes the new cookie on.
 */
export async function sessionUserFrom(headers: Headers): Promise<SessionUser | null> {
  const found = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } }).catch((e) => {
    console.error("Session lookup failed", e);
    return null;
  });
  if (!found) return null;
  return loadActiveUser(found.user.id);
}

/** The signed-in, active user for this request (memoised per request). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => sessionUserFrom(await headers()));

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
