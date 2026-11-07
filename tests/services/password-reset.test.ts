import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CODE_FAILED, RESET_CODE_TRIES } from "@/lib/reset-code";
import { verifyPassword } from "@/lib/password-hash";
import { sessionUserFrom } from "@/server/auth";
import { db } from "@/server/db/client";
import { account, passwordResetCodes, profiles, settings } from "@/server/db/schema";
import type { Email } from "@/server/email";
import { Forbidden } from "@/server/errors";
import { HOUR, takeLimit } from "@/server/rate-limit";
import {
  REQUESTS_PER_DEVICE,
  REQUESTS_PER_EMAIL_DAY,
  REQUESTS_PER_EMAIL_HOUR,
  requestResetCode,
  resetWithCode,
  type ResetDeps,
} from "@/server/services/password-reset";
import { setCanGetEmails, setUserPassword } from "@/server/services/users";
import { resetDb } from "../helpers/db";
import { LOGIN_PASSWORD, makeLogin, makeUser } from "../helpers/factories";
import { signedInHeaders } from "../helpers/sessions";

const NEW_PASSWORD = "new-counter-pass";

/** Fake email: records what would have been sent. */
function fakes(opts: { sendFails?: boolean } = {}) {
  const sent: Email[] = [];
  const deps: ResetDeps = {
    secret: "test-secret",
    send: async (email) => {
      if (opts.sendFails) return { ok: false, error: "down" };
      sent.push(email);
      return { ok: true };
    },
  };
  const codeIn = (email: Email) => /Your code is (\d{6})/.exec(email.text)?.[1] ?? "";
  return { deps, sent, codeIn };
}

/** True when `password` is the login's current password. */
async function passwordIs(userId: string, password: string): Promise<boolean> {
  const [row] = await db.select({ hash: account.password }).from(account).where(eq(account.userId, userId));
  return verifyPassword({ hash: row?.hash ?? "", password });
}

let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

async function askCode(email: string, deps: ResetDeps, now?: Date) {
  return requestResetCode({ email, ip: freshIp(), now }, deps);
}

async function tryCode(email: string, code: string, deps: ResetDeps, extra: Partial<{ now: Date; confirm: string }> = {}) {
  return resetWithCode(
    {
      email,
      code,
      newPassword: NEW_PASSWORD,
      confirmPassword: extra.confirm ?? NEW_PASSWORD,
      ip: freshIp(),
      now: extra.now,
    },
    deps,
  );
}

describe("password reset by email", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("asking for a code", () => {
    it("emails a 6-digit code to a ticked, active login and keeps only a scrambled copy", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await expect(askCode(`  ${user.email.toUpperCase()} `, f.deps)).resolves.toBe("sent");
      expect(f.sent).toHaveLength(1);
      expect(f.sent[0].to).toBe(user.email);
      const code = f.codeIn(f.sent[0]);
      expect(code).toMatch(/^\d{6}$/);
      expect(f.sent[0].subject).not.toContain(code);
      const [row] = await db.select().from(passwordResetCodes);
      expect(row).toMatchObject({ email: user.email, userId: user.id, tries: 0 });
      expect(row.codeHash).not.toContain(code);
    });

    it("names the company in the subject, or Sparepartslk when no name is saved", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(user.email, f.deps);
      expect(f.sent[0].subject).toBe("Your Sparepartslk password code");
      await db.update(settings).set({ businessName: "Silva Motors" });
      await askCode(user.email, f.deps);
      expect(f.sent[1].subject).toBe("Your Silva Motors password code");
    });

    it("sends nothing to unknown, turned-off or unticked logins", async () => {
      const off = await makeUser("staff", { canGetEmails: true, isActive: false });
      const unticked = await makeUser("staff");
      const f = fakes();
      for (const email of ["nobody@test.local", off.email, unticked.email]) {
        await expect(askCode(email, f.deps)).resolves.toBe("skipped");
      }
      expect(f.sent).toHaveLength(0);
      expect(await db.select().from(passwordResetCodes)).toHaveLength(0);
    });

    it("limits each email to 3 an hour and 10 a day", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      const start = new Date("2026-11-07T00:00:00Z");
      for (let i = 0; i < REQUESTS_PER_EMAIL_HOUR; i++) await expect(askCode(user.email, f.deps, start)).resolves.toBe("sent");
      await expect(askCode(user.email, f.deps, start)).resolves.toBe("skipped");

      let sent = REQUESTS_PER_EMAIL_HOUR;
      for (let hour = 1; sent < REQUESTS_PER_EMAIL_DAY + 2; hour++) {
        const at = new Date(start.getTime() + hour * HOUR + 1000);
        if ((await askCode(user.email, f.deps, at)) === "sent") sent += 1;
        else break;
      }
      expect(sent).toBe(REQUESTS_PER_EMAIL_DAY);
      expect(f.sent).toHaveLength(REQUESTS_PER_EMAIL_DAY);
    });

    it("limits each device to 10 requests an hour, whichever emails it tries", async () => {
      const f = fakes();
      const user = await makeLogin("staff", { canGetEmails: true });
      for (let i = 0; i < REQUESTS_PER_DEVICE; i++) await requestResetCode({ email: `x${i}@test.local`, ip: "9.9.9.9" }, f.deps);
      await expect(requestResetCode({ email: user.email, ip: "9.9.9.9" }, f.deps)).resolves.toBe("skipped");
      expect(f.sent).toHaveLength(0);
    });

    it("replaces the old code with the new one", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(user.email, f.deps);
      await askCode(user.email, f.deps);
      const [first, second] = f.sent.map(f.codeIn);
      expect(await db.select().from(passwordResetCodes)).toHaveLength(1);
      if (first !== second) await expect(tryCode(user.email, first, f.deps)).resolves.toEqual({ ok: false, message: CODE_FAILED });
      await expect(tryCode(user.email, second, f.deps)).resolves.toEqual({ ok: true });
    });

    it("says skipped (never throws) when the email can't be sent", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      await expect(askCode(user.email, fakes({ sendFails: true }).deps)).resolves.toBe("skipped");
    });
  });

  describe("using the code", () => {
    it("sets the new password, spends the code, signs out old sessions and sends a notice", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(user.email, f.deps);
      const before = await signedInHeaders(user.email, LOGIN_PASSWORD);
      await expect(tryCode(user.email, f.codeIn(f.sent[0]), f.deps)).resolves.toEqual({ ok: true });

      await expect(passwordIs(user.id, NEW_PASSWORD)).resolves.toBe(true);
      await expect(passwordIs(user.id, LOGIN_PASSWORD)).resolves.toBe(false);
      expect(await db.select().from(passwordResetCodes)).toHaveLength(0);
      expect(f.sent[1].subject).toMatch(/password was changed/);

      await expect(sessionUserFrom(before)).resolves.toBeNull();
      await expect(sessionUserFrom(await signedInHeaders(user.email, NEW_PASSWORD))).resolves.toEqual(user);
      // Works once.
      await expect(tryCode(user.email, f.codeIn(f.sent[0]), f.deps)).resolves.toEqual({ ok: false, message: CODE_FAILED });
    });

    it("names the company in the changed-password notice", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      await db.update(settings).set({ businessName: "Silva Motors" });
      const f = fakes();
      await askCode(user.email, f.deps);
      await expect(tryCode(user.email, f.codeIn(f.sent[0]), f.deps)).resolves.toEqual({ ok: true });
      expect(f.sent[1].subject).toBe("Your Silva Motors password was changed");
    });

    it("checks the new password before the code, so a short one costs no try", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(user.email, f.deps);
      const short = await resetWithCode(
        { email: user.email, code: "000000", newPassword: "short", confirmPassword: "short", ip: freshIp() },
        f.deps,
      );
      expect(short).toMatchObject({ ok: false, field: "newPassword" });
      await expect(tryCode(user.email, "000000", f.deps, { confirm: "different-pass" })).resolves.toMatchObject({
        field: "confirmPassword",
      });
      const [row] = await db.select().from(passwordResetCodes);
      expect(row.tries).toBe(0);
    });

    it("throws the code away after 5 wrong tries, even if the right code comes next", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(user.email, f.deps);
      const code = f.codeIn(f.sent[0]);
      const wrong = code === "000000" ? "111111" : "000000";
      for (let i = 0; i < RESET_CODE_TRIES; i++) {
        await expect(tryCode(user.email, wrong, f.deps)).resolves.toEqual({ ok: false, message: CODE_FAILED });
      }
      await expect(tryCode(user.email, code, f.deps)).resolves.toEqual({ ok: false, message: CODE_FAILED });
      await expect(passwordIs(user.id, LOGIN_PASSWORD)).resolves.toBe(true);
    });

    it("refuses an expired code, and a code for a login that was turned off since", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(user.email, f.deps);
      const code = f.codeIn(f.sent[0]);
      const in16min = new Date(Date.now() + 16 * 60_000);
      await expect(tryCode(user.email, code, f.deps, { now: in16min })).resolves.toEqual({ ok: false, message: CODE_FAILED });

      await askCode(user.email, f.deps);
      await db.update(profiles).set({ isActive: false }).where(eq(profiles.userId, user.id));
      await expect(tryCode(user.email, f.codeIn(f.sent[1]), f.deps)).resolves.toEqual({ ok: false, message: CODE_FAILED });
      await expect(passwordIs(user.id, LOGIN_PASSWORD)).resolves.toBe(true);
    });

    it("gives the same answer for an email with no code", async () => {
      await expect(tryCode("nobody@test.local", "123456", fakes().deps)).resolves.toEqual({ ok: false, message: CODE_FAILED });
    });

    it("counts guesses sent at the same moment: never more than 5 looked at", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(user.email, f.deps);
      const code = f.codeIn(f.sent[0]);
      const wrong = Array.from({ length: 30 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, "0"));
      const results = await Promise.all(wrong.map((w) => tryCode(user.email, w, f.deps)));
      expect(results.every((r) => !r.ok)).toBe(true);
      const [row] = await db.select().from(passwordResetCodes);
      expect(row?.tries ?? RESET_CODE_TRIES).toBeLessThanOrEqual(RESET_CODE_TRIES);
    });

    it("lets only one of several same-moment submits of the right code save a password", async () => {
      const user = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(user.email, f.deps);
      const code = f.codeIn(f.sent[0]);
      const results = await Promise.all(Array.from({ length: 8 }, () => tryCode(user.email, code, f.deps)));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(f.sent.filter((e) => /password was changed/.test(e.subject))).toHaveLength(1);
      await expect(passwordIs(user.id, NEW_PASSWORD)).resolves.toBe(true);
    });
  });

  describe("admin", () => {
    it("sets a password, signs that login out everywhere and throws away its codes", async () => {
      const admin = await makeUser("admin");
      const staff = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(staff.email, f.deps);
      const first = await signedInHeaders(staff.email, LOGIN_PASSWORD);
      const second = await signedInHeaders(staff.email, LOGIN_PASSWORD);
      await setUserPassword(admin, staff.id, "admin-set-pass");
      await expect(passwordIs(staff.id, "admin-set-pass")).resolves.toBe(true);
      expect(await db.select().from(passwordResetCodes)).toHaveLength(0);
      await expect(sessionUserFrom(first)).resolves.toBeNull();
      await expect(sessionUserFrom(second)).resolves.toBeNull();
    });

    it("only lets an admin set passwords or the email tick", async () => {
      const staff = await makeUser("staff");
      const other = await makeUser("staff");
      await expect(setUserPassword(staff, other.id, "whatever-pass")).rejects.toThrow(
        Forbidden,
      );
      await expect(setCanGetEmails(staff, other.id, true)).rejects.toThrow(Forbidden);
    });

    it("turning the email tick off throws away a code already sent", async () => {
      const admin = await makeUser("admin");
      const staff = await makeLogin("staff", { canGetEmails: true });
      const f = fakes();
      await askCode(staff.email, f.deps);
      await setCanGetEmails(admin, staff.id, false);
      expect(await db.select().from(passwordResetCodes)).toHaveLength(0);
      const [p] = await db.select().from(profiles).where(eq(profiles.userId, staff.id));
      expect(p.canGetEmails).toBe(false);
    });
  });

  describe("rate limit counter", () => {
    it("counts every request sent at the same moment and starts again in a new window", async () => {
      const start = new Date("2026-11-07T00:00:00Z");
      const results = await Promise.all(Array.from({ length: 12 }, () => takeLimit("t/burst", 5, HOUR, start)));
      expect(results.filter(Boolean)).toHaveLength(5);
      await expect(takeLimit("t/burst", 5, HOUR, new Date(start.getTime() + HOUR))).resolves.toBe(true);
    });
  });
});
