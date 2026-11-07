import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogin } from "@/server/auth-admin";
import { db } from "@/server/db/client";
import { profiles, rateLimits, session } from "@/server/db/schema";
import { giveBack, takeLimit, HOUR } from "@/server/rate-limit";
import { signIn } from "@/server/services/sign-in";
import { resetDb } from "../helpers/db";

const PASSWORD = "counter-pass-1";
const INCORRECT = "Email or password is incorrect";
const TURNED_OFF = "This account is turned off. Ask the owner to turn it back on.";
const TOO_MANY = "Too many tries. Wait a while and try again.";

let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

async function login(email = "admin@shop.lk") {
  return createLogin({ email, name: "Admin", password: PASSWORD, role: "admin" });
}

async function count(key: string) {
  const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  return row?.count;
}

const attempt = (email: string, password: string, ip: string) => signIn({ email, password, ip, headers: new Headers() });

describe("signIn", () => {
  beforeEach(resetDb);

  it("signs in with the right password and hands both limit counts back", async () => {
    await login();
    const ip = freshIp();
    const result = await attempt("admin@shop.lk", PASSWORD, ip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers.getSetCookie().join(";")).toContain("better-auth.session_token=");
    expect(await count("login-email/admin@shop.lk")).toBe(0);
    expect(await count(`login-ip/${ip}`)).toBe(0);
  });

  it("refuses a wrong password with the plain message and makes no session", async () => {
    await login();
    await expect(attempt("admin@shop.lk", "wrong-pass-1", freshIp())).resolves.toEqual({ ok: false, error: INCORRECT });
    expect(await db.select().from(session)).toHaveLength(0);
  });

  it("refuses an unknown email with the same message", async () => {
    await expect(attempt("nobody@shop.lk", PASSWORD, freshIp())).resolves.toEqual({ ok: false, error: INCORRECT });
  });

  it("accepts an email typed with capitals and spaces", async () => {
    await login("admin@shop.lk");
    const result = await attempt(" Admin@Shop.LK ", PASSWORD, freshIp());
    expect(result.ok).toBe(true);
  });

  it("refuses a turned-off login and leaves it no session", async () => {
    const { id } = await login();
    await db.update(profiles).set({ isActive: false }).where(eq(profiles.userId, id));
    await expect(attempt("admin@shop.lk", PASSWORD, freshIp())).resolves.toEqual({ ok: false, error: TURNED_OFF });
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(0);
  });

  it("after 10 wrong tries for one email, refuses even the right password typed differently", async () => {
    await login();
    for (let i = 0; i < 10; i++) {
      await expect(attempt("admin@shop.lk", "wrong-pass-1", freshIp())).resolves.toMatchObject({ error: INCORRECT });
    }
    await expect(attempt(" ADMIN@shop.lk", PASSWORD, freshIp())).resolves.toEqual({ ok: false, error: TOO_MANY });
  });

  it("after 30 wrong tries from one device, refuses the 31st", async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) {
      await expect(attempt(`user${i}@shop.lk`, "wrong-pass-1", ip)).resolves.toMatchObject({ error: INCORRECT });
    }
    await expect(attempt("user99@shop.lk", "wrong-pass-1", ip)).resolves.toEqual({ ok: false, error: TOO_MANY });
  });

  it("does not use up the limit with successful sign-ins", async () => {
    await login();
    const ip = freshIp();
    for (let i = 0; i < 15; i++) {
      await expect(attempt("admin@shop.lk", PASSWORD, ip)).resolves.toMatchObject({ ok: true });
    }
  });
});

describe("giveBack", () => {
  beforeEach(resetDb);

  it("lowers the count and never below 0", async () => {
    await takeLimit("k", 5, HOUR);
    await giveBack("k");
    expect(await count("k")).toBe(0);
    await giveBack("k");
    expect(await count("k")).toBe(0);
    await giveBack("missing");
    expect(await db.execute(sql`select 1 from rate_limits where key = 'missing'`)).toHaveLength(0);
  });
});
