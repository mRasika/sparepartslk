import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionUserFrom } from "@/server/auth";
import { createLogin } from "@/server/auth-admin";
import { db } from "@/server/db/client";
import { session } from "@/server/db/schema";
import { config, middleware } from "@/middleware";
import { resetDb } from "../helpers/db";
import { signedInHeaders } from "../helpers/sessions";

const DAY = 86_400_000;
const PASSWORD = "counter-pass-1";

/** A session last renewed 2 days ago, so the next renewing lookup must push its expiry out. */
async function staleSession() {
  const { id } = await createLogin({ email: "staff@shop.lk", name: "Staff", password: PASSWORD, role: "staff" });
  const headers = await signedInHeaders("staff@shop.lk", PASSWORD);
  const old = new Date(Date.now() - 2 * DAY);
  const expires = new Date(Date.now() + 28 * DAY);
  await db.update(session).set({ updatedAt: old, expiresAt: expires }).where(eq(session.userId, id));
  // Keep only the session token: a stale cookie cache would answer without reading the row.
  const cookie = headers.get("cookie")!.split("; ").filter((c) => c.includes("session_token")).join("; ");
  return { id, headers: new Headers({ cookie }), expires };
}

async function expiresAt(userId: string) {
  const [row] = await db.select({ expiresAt: session.expiresAt }).from(session).where(eq(session.userId, userId));
  return row.expiresAt;
}

describe("middleware", () => {
  beforeEach(resetDb);

  it("sends a visitor with no session to /login, dropping the query", async () => {
    const res = await middleware(new NextRequest("http://localhost/invoices?q=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("renews a day-old session and passes the new cookie on", async () => {
    const { id, headers, expires } = await staleSession();
    const res = await middleware(new NextRequest("http://localhost/dashboard", { headers }));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(true);
    expect((await expiresAt(id)).getTime()).toBeGreaterThan(expires.getTime() + DAY);
  });

  it("matches app pages but not static files", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test("/dashboard")).toBe(true);
    expect(pattern.test("/reportsvg")).toBe(true);
    expect(pattern.test("/logo.svg")).toBe(false);
    expect(pattern.test("/login")).toBe(false);
  });

  it("lets the setup screen through without a session, but nothing that merely starts with it", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test("/setup")).toBe(false);
    expect(pattern.test("/setupx")).toBe(true);
    expect(pattern.test("/settings")).toBe(true);
  });

  it("lets the health check through without a session, but still guards the logo", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test("/api/health")).toBe(false);
    expect(pattern.test("/api/healthx")).toBe(true);
    expect(pattern.test("/api/logo")).toBe(true);
  });
});

describe("sessionUserFrom", () => {
  beforeEach(resetDb);

  it("never renews the session itself (a page can't set the cookie; the middleware does)", async () => {
    const { id, headers, expires } = await staleSession();
    await expect(sessionUserFrom(headers)).resolves.toMatchObject({ id });
    expect((await expiresAt(id)).getTime()).toBe(expires.getTime());
  });
});
