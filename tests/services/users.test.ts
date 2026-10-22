import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { Forbidden, InvalidState } from "@/server/errors";
import { createUser, setUserActive, setUserRole, type AuthAdmin } from "@/server/services/users";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

function fakeAuthAdmin(): AuthAdmin & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async createUser(args) {
      calls.push(args);
      return { data: { user: { id: randomUUID() } }, error: null };
    },
  };
}

describe("users", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates the auth user and a profile with the chosen role", async () => {
    const admin = await makeUser("admin");
    const auth = fakeAuthAdmin();
    const { id } = await createUser(
      admin,
      { email: "Kasun@Example.lk", fullName: "Kasun", role: "staff", password: "counter-2026" },
      { authAdmin: auth },
    );
    expect(auth.calls[0]).toMatchObject({ email: "kasun@example.lk", password: "counter-2026", email_confirm: true });
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, id));
    expect(p).toMatchObject({ email: "kasun@example.lk", fullName: "Kasun", role: "staff", isActive: true });
  });

  it("only lets admins create users", async () => {
    const staff = await makeUser("staff");
    await expect(
      createUser(staff, { email: "a@b.lk", fullName: "A", role: "staff", password: "x1234567" }, { authAdmin: fakeAuthAdmin() }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("won't demote the only active admin", async () => {
    const admin = await makeUser("admin");
    await expect(setUserRole(admin, admin.id, "staff")).rejects.toBeInstanceOf(InvalidState);
  });

  it("demotes an admin when another active admin remains", async () => {
    const admin = await makeUser("admin");
    const other = await makeUser("admin");
    await setUserRole(admin, other.id, "staff");
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, other.id));
    expect(p.role).toBe("staff");
  });

  it("won't let an admin deactivate themself", async () => {
    const admin = await makeUser("admin");
    await expect(setUserActive(admin, admin.id, false)).rejects.toBeInstanceOf(InvalidState);
  });

  it("deactivates another user", async () => {
    const admin = await makeUser("admin");
    const staff = await makeUser("staff");
    await setUserActive(admin, staff.id, false);
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, staff.id));
    expect(p.isActive).toBe(false);
  });
});
