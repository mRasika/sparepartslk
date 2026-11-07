import { compare, hash } from "bcryptjs";

/** bcrypt with cost 10, the same as Supabase Auth, so copied Supabase hashes keep working. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, 10);
}

/** True when `password` matches the bcrypt `hash`. False (never throws) for anything else. */
export async function verifyPassword({ hash: stored, password }: { hash: string; password: string }): Promise<boolean> {
  if (!stored.startsWith("$2")) return false;
  try {
    return await compare(password, stored);
  } catch {
    return false;
  }
}
