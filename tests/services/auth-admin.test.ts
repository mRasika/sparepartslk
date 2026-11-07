import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { verifyPassword } from "@/lib/password-hash";
import { createLogin, endSessions, setPassword } from "@/server/auth-admin";
import { db } from "@/server/db/client";
import { account, profiles, session, user } from "@/server/db/schema";
import { DomainError, NotFound } from "@/server/errors";
import { resetDb } from "../helpers/db";

const base = { name: "Kamal Perera", password: "first-pass-1", role: "staff" as const };

async function addSession(userId: string) {
  await db.insert(session).values({ token: randomUUID(), userId, expiresAt: new Date(Date.now() + 86_400_000) });
}

async function credentialHash(userId: string) {
  const [row] = await db.select().from(account).where(eq(account.userId, userId));
  return row.password!;
}

describe("auth-admin", () => {
  beforeEach(resetDb);

  it("createLogin writes user, credential account and profile with one id", async () => {
    const { id } = await createLogin({ ...base, email: "kamal@shop.lk", canGetEmails: true });
    const [u] = await db.select().from(user).where(eq(user.id, id));
    const [a] = await db.select().from(account).where(eq(account.userId, id));
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, id));
    expect(u).toMatchObject({ email: "kamal@shop.lk", name: "Kamal Perera", emailVerified: true });
    expect(a).toMatchObject({ providerId: "credential", accountId: id });
    expect(p).toMatchObject({ email: "kamal@shop.lk", fullName: "Kamal Perera", role: "staff", canGetEmails: true });
    await expect(verifyPassword({ hash: a.password!, password: "first-pass-1" })).resolves.toBe(true);
  });

  it("createLogin stores the email trimmed and lowercased", async () => {
    const { id } = await createLogin({ ...base, email: "  Mixed@Case.LK " });
    const [u] = await db.select().from(user).where(eq(user.id, id));
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, id));
    expect(u.email).toBe("mixed@case.lk");
    expect(p.email).toBe("mixed@case.lk");
  });

  it("createLogin refuses a duplicate email and leaves one set of rows", async () => {
    await createLogin({ ...base, email: "dup@shop.lk" });
    const err = await createLogin({ ...base, email: "DUP@shop.lk" }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("Duplicate");
    expect(err.field).toBe("email");
    expect(await db.select().from(user)).toHaveLength(1);
    expect(await db.select().from(account)).toHaveLength(1);
    expect(await db.select().from(profiles)).toHaveLength(1);
  });

  it("createLogin uses an explicit id", async () => {
    const id = randomUUID();
    await expect(createLogin({ ...base, id, email: "given@shop.lk" })).resolves.toEqual({ id });
  });

  it("setPassword changes the hash and ends only that user's sessions", async () => {
    const { id } = await createLogin({ ...base, email: "a@shop.lk" });
    const other = await createLogin({ ...base, email: "b@shop.lk" });
    await addSession(id);
    await addSession(id);
    await addSession(other.id);

    await setPassword(id, "second-pass-2");

    const hash = await credentialHash(id);
    await expect(verifyPassword({ hash, password: "second-pass-2" })).resolves.toBe(true);
    await expect(verifyPassword({ hash, password: "first-pass-1" })).resolves.toBe(false);
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, other.id))).toHaveLength(1);
  });

  it("setPassword on an unknown id is NotFound", async () => {
    await expect(setPassword(randomUUID(), "second-pass-2")).rejects.toBeInstanceOf(NotFound);
  });

  it("endSessions deletes only that user's sessions", async () => {
    const { id } = await createLogin({ ...base, email: "a@shop.lk" });
    const other = await createLogin({ ...base, email: "b@shop.lk" });
    await addSession(id);
    await addSession(other.id);
    await endSessions(id);
    expect(await db.select().from(session).where(eq(session.userId, id))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, other.id))).toHaveLength(1);
  });
});
