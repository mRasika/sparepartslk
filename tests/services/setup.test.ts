import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { customers, priceTiers, profiles, settings, user } from "@/server/db/schema";
import { signIn } from "@/server/services/sign-in";
import { companyExists, setupCompany, setupKeyState } from "@/server/services/setup";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

const KEY = "k".repeat(24);
const LOCKED = "Setup is locked. Put a SETUP_KEY of at least 24 characters in the stack settings, then reload this page.";
const PASSWORD = "owner-pass-123";

let ipCounter = 0;
const freshIp = () => `10.7.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

const form = (over: Partial<Record<string, string>> = {}) => ({
  setupKey: KEY,
  businessName: "Silva Motors",
  ownerName: "Kamal Silva",
  email: "Owner@Silva.LK",
  password: PASSWORD,
  confirmPassword: PASSWORD,
  ...over,
});

/** An empty company: no logins, no settings, tiers or walk-in customer. */
async function emptyDb() {
  await resetDb();
  await db.delete(customers);
  await db.delete(priceTiers);
  await db.delete(settings);
}

describe("setup", () => {
  beforeEach(emptyDb);

  it("companyExists is false with no logins and true after one", async () => {
    await expect(companyExists()).resolves.toBe(false);
    await makeUser("staff");
    await expect(companyExists()).resolves.toBe(true);
  });

  it("setupKeyState needs a key of at least 24 characters", () => {
    for (const key of [undefined, "", "x".repeat(23), `  ${"x".repeat(22)}  `]) expect(setupKeyState(key)).toBe("missing");
    expect(setupKeyState(KEY)).toBe("ready");
  });

  it("is locked without a long enough SETUP_KEY, and writes nothing", async () => {
    for (const setupKey of [undefined, "short-key"]) {
      await expect(setupCompany(form(), { ip: freshIp() }, { setupKey })).resolves.toEqual({ ok: false, message: LOCKED });
    }
    expect(await db.select().from(profiles)).toHaveLength(0);
  });

  it("refuses a wrong key on the key field, and writes nothing", async () => {
    await expect(setupCompany(form({ setupKey: "w".repeat(24) }), { ip: freshIp() }, { setupKey: KEY })).resolves.toEqual({
      ok: false,
      field: "setupKey",
      message: "The setup key is wrong.",
    });
    expect(await db.select().from(profiles)).toHaveLength(0);
  });

  it("accepts the key pasted with spaces or a newline around it", async () => {
    const result = await setupCompany(form({ setupKey: `  ${KEY}\n` }), { ip: freshIp() }, { setupKey: KEY });
    expect(result.ok).toBe(true);
  });

  it("sets up the company: base data, business name and one admin who can sign in", async () => {
    const result = await setupCompany(form(), { ip: freshIp() }, { setupKey: KEY });
    expect(result).toMatchObject({ ok: true, email: "owner@silva.lk" });

    const [s] = await db.select().from(settings);
    expect(s.businessName).toBe("Silva Motors");
    expect(await db.select().from(priceTiers)).toHaveLength(3);
    expect((await db.select().from(customers)).filter((c) => c.isWalkIn)).toHaveLength(1);
    const owners = await db.select().from(profiles);
    expect(owners).toEqual([expect.objectContaining({ email: "owner@silva.lk", fullName: "Kamal Silva", role: "admin", isActive: true })]);

    const signedIn = await signIn({ email: "OWNER@silva.lk", password: PASSWORD, ip: freshIp(), headers: new Headers() });
    expect(signedIn.ok).toBe(true);
  });

  it("refuses a blank business name and passwords that don't match", async () => {
    await expect(setupCompany(form({ businessName: "   " }), { ip: freshIp() }, { setupKey: KEY })).resolves.toMatchObject({
      ok: false,
      field: "businessName",
    });
    await expect(
      setupCompany(form({ confirmPassword: "different-pass-1" }), { ip: freshIp() }, { setupKey: KEY }),
    ).resolves.toEqual({ ok: false, field: "confirmPassword", message: "The two passwords don't match" });
    expect(await db.select().from(profiles)).toHaveLength(0);
  });

  it("is closed for good once a company exists", async () => {
    await setupCompany(form(), { ip: freshIp() }, { setupKey: KEY });
    await expect(setupCompany(form({ email: "other@silva.lk" }), { ip: freshIp() }, { setupKey: KEY })).resolves.toEqual({
      ok: false,
      message: "This system is already set up. Sign in instead.",
    });
    expect(await db.select().from(profiles)).toHaveLength(1);
  });

  it("creates exactly one company when eight setups arrive at the same moment", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => setupCompany(form({ email: `owner${i}@silva.lk` }), { ip: freshIp() }, { setupKey: KEY })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(profiles)).toHaveLength(1);
    expect(await db.select().from(user)).toHaveLength(1);
  });

  it("refuses the 11th try from one device in an hour, even with the right key", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      await expect(setupCompany(form({ setupKey: "w".repeat(24) }), { ip }, { setupKey: KEY })).resolves.toMatchObject({
        field: "setupKey",
      });
    }
    await expect(setupCompany(form(), { ip }, { setupKey: KEY })).resolves.toEqual({
      ok: false,
      message: "Too many tries. Wait a while and try again.",
    });
  });
});
