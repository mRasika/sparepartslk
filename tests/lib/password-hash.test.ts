import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password-hash";

// Real hash from local Supabase Auth (GoTrue) for the e2e admin password.
const SUPABASE_HASH = "$2a$10$NSXIN4Nd.ta3dk4Z8G4t/Ocv/hNxTDIaAmlKa0UYk7QFn49Nd1/Jm";

describe("password hashing", () => {
  it("verifies a password hashed by Supabase", async () => {
    await expect(verifyPassword({ hash: SUPABASE_HASH, password: "e2e-admin-pass-1" })).resolves.toBe(true);
    await expect(verifyPassword({ hash: SUPABASE_HASH, password: "e2e-admin-pass-2" })).resolves.toBe(false);
  });

  it("hashes with bcrypt cost 10 and verifies its own hashes", async () => {
    const hash = await hashPassword("counter-pass-1");
    expect(hash).toMatch(/^\$2[ab]\$10\$/);
    await expect(verifyPassword({ hash, password: "counter-pass-1" })).resolves.toBe(true);
  });

  it("says false (never throws) for a hash that isn't bcrypt", async () => {
    await expect(verifyPassword({ hash: "scrypt:abc", password: "x" })).resolves.toBe(false);
  });
});
