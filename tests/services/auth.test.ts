import { beforeEach, describe, expect, it } from "vitest";
import { loadActiveUser, requireRole } from "@/server/auth";
import { Forbidden } from "@/server/errors";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

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
