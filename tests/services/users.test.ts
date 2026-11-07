import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { account, profiles } from "@/server/db/schema";
import { sessionUserFrom } from "@/server/auth";
import { Forbidden, InvalidState } from "@/server/errors";
import { createUser, setUserActive, setUserRole } from "@/server/services/users";
import { signIn } from "@/server/services/sign-in";
import { resetDb } from "../helpers/db";
import { LOGIN_PASSWORD, makeLogin, makeUser } from "../helpers/factories";
import { signedInHeaders } from "../helpers/sessions";

describe("users", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a login that can sign in, with a profile in the chosen role", async () => {
    const admin = await makeUser("admin");
    const { id } = await createUser(admin, {
      email: "Kasun@Example.lk",
      fullName: "Kasun",
      role: "staff",
      password: "counter-2026",
    });
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, id));
    expect(p).toMatchObject({ email: "kasun@example.lk", fullName: "Kasun", role: "staff", isActive: true });
    expect(await db.select().from(account).where(eq(account.userId, id))).toHaveLength(1);
    const signedIn = await signIn({ email: "kasun@example.lk", password: "counter-2026", ip: "10.9.9.9", headers: new Headers() });
    expect(signedIn.ok).toBe(true);
  });

  it("refuses an email that already has an account", async () => {
    const admin = await makeUser("admin");
    const input = { email: "dup@example.lk", fullName: "Dup", role: "staff" as const, password: "counter-2026" };
    await createUser(admin, input);
    await expect(createUser(admin, { ...input, email: "DUP@example.lk" })).rejects.toMatchObject({ code: "Duplicate" });
  });

  it("only lets admins create users", async () => {
    const staff = await makeUser("staff");
    await expect(
      createUser(staff, { email: "a@b.lk", fullName: "A", role: "staff", password: "x1234567" }),
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

  it("turning a login off signs it out at once", async () => {
    const admin = await makeUser("admin");
    const staff = await makeLogin("staff");
    const headers = await signedInHeaders(staff.email, LOGIN_PASSWORD);
    await expect(sessionUserFrom(headers)).resolves.toEqual(staff);
    await setUserActive(admin, staff.id, false);
    await expect(sessionUserFrom(headers)).resolves.toBeNull();
    await setUserActive(admin, staff.id, true);
    await expect(sessionUserFrom(headers)).resolves.toBeNull();
  });

  it("deactivates another user", async () => {
    const admin = await makeUser("admin");
    const staff = await makeUser("staff");
    await setUserActive(admin, staff.id, false);
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, staff.id));
    expect(p.isActive).toBe(false);
  });
});
