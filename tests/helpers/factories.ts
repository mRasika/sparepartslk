import { randomUUID } from "node:crypto";
import { db } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import type { Role, SessionUser } from "@/server/auth";

let counter = 0;

/** Inserts a profile with a random user id (no Supabase auth user needed). */
export async function makeUser(
  role: Role,
  overrides: Partial<{ fullName: string; email: string; isActive: boolean }> = {},
): Promise<SessionUser> {
  counter += 1;
  const id = randomUUID();
  const email = overrides.email ?? `${role}${counter}-${id.slice(0, 8)}@test.local`;
  const fullName = overrides.fullName ?? `Test ${role} ${counter}`;
  await db.insert(profiles).values({
    userId: id,
    email,
    fullName,
    role,
    isActive: overrides.isActive ?? true,
  });
  return { id, email, fullName, role };
}
