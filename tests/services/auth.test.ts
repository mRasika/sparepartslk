import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadActiveUser, requireRole, sessionUserFrom } from "@/server/auth";
import { createLogin, endSessions } from "@/server/auth-admin";
import { auth } from "@/server/better-auth";
import { db } from "@/server/db/client";
import { profiles, session } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";
import { signedInHeaders } from "../helpers/sessions";

const PASSWORD = "counter-pass-1";

async function login(email = "staff@shop.lk") {
  const { id } = await createLogin({ email, name: "Nimal Silva", password: PASSWORD, role: "staff" });
  return { id, email };
}

describe("auth", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loadActiveUser returns the role for an active profile", async () => {
    const admin = await makeUser("admin");
    await expect(loadActiveUser(admin.id)).resolves.toEqual(admin);
  });

  it("loadActiveUser returns null for an inactive profile", async () => {
    const staff = await makeUser("staff", { isActive: false });
    await expect(loadActiveUser(staff.id)).resolves.toBeNull();
  });

  it("loadActiveUser returns null when there is no profile", async () => {
    await expect(loadActiveUser("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("requireRole rejects staff for admin-only actions", async () => {
    const staff = await makeUser("staff");
    expect(() => requireRole(staff, "admin")).toThrow(Forbidden);
  });

  it("requireRole lets an admin through", async () => {
    const admin = await makeUser("admin");
    expect(() => requireRole(admin, "admin")).not.toThrow();
  });
});

describe("sessionUserFrom", () => {
  beforeEach(resetDb);

  it("gives the user for a valid session", async () => {
    const { id, email } = await login();
    const headers = await signedInHeaders(email, PASSWORD);
    await expect(sessionUserFrom(headers)).resolves.toEqual({ id, email, fullName: "Nimal Silva", role: "staff" });
  });

  it("gives null with no cookie", async () => {
    await expect(sessionUserFrom(new Headers())).resolves.toBeNull();
  });

  it("gives null for a tampered cookie", async () => {
    const { email } = await login();
    const cookie = (await signedInHeaders(email, PASSWORD)).get("cookie")!;
    const at = cookie.indexOf("=") + 3;
    const changed = cookie.slice(0, at) + (cookie[at] === "a" ? "b" : "a") + cookie.slice(at + 1);
    await expect(sessionUserFrom(new Headers({ cookie: changed }))).resolves.toBeNull();
  });

  it("gives null for an expired session", async () => {
    const { id, email } = await login();
    const headers = await signedInHeaders(email, PASSWORD);
    await db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.userId, id));
    await expect(sessionUserFrom(headers)).resolves.toBeNull();
  });

  it("gives null after endSessions", async () => {
    const { id, email } = await login();
    const headers = await signedInHeaders(email, PASSWORD);
    await endSessions(id);
    await expect(sessionUserFrom(headers)).resolves.toBeNull();
  });

  it("gives null once the profile is turned off", async () => {
    const { id, email } = await login();
    const headers = await signedInHeaders(email, PASSWORD);
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.userId, id));
    await expect(sessionUserFrom(headers)).resolves.toBeNull();
  });

  it("keeps two devices apart: signing out one leaves the other signed in", async () => {
    const { id, email } = await login();
    const first = await signedInHeaders(email, PASSWORD);
    const second = await signedInHeaders(email, PASSWORD);
    await expect(sessionUserFrom(first)).resolves.toMatchObject({ id });
    await expect(sessionUserFrom(second)).resolves.toMatchObject({ id });

    await auth.api.signOut({ headers: first });

    await expect(sessionUserFrom(first)).resolves.toBeNull();
    await expect(sessionUserFrom(second)).resolves.toMatchObject({ id });
  });

  it("refuses sign-up", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "new@shop.lk", password: "new-pass-123", name: "New" } }),
    ).rejects.toThrow();
  });
});
