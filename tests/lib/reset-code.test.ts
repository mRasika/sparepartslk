import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { passwordSchema } from "@/lib/password";
import { checkCode, cleanCode, hashCode, makeCode, RESET_CODE_TRIES } from "@/lib/reset-code";
import { requestIp } from "@/server/request-ip";

const SECRET = "test-secret";
const now = new Date("2026-11-07T10:00:00Z");
const later = new Date(now.getTime() + 60_000);

describe("reset codes", () => {
  it("makes six digits and keeps leading zeros", () => {
    expect(makeCode(() => 42)).toBe("000042");
    expect(makeCode()).toMatch(/^\d{6}$/);
  });

  it("accepts spaces and dashes, and nothing but six digits", () => {
    expect(cleanCode(" 123 456 ")).toBe("123456");
    expect(cleanCode("123-456")).toBe("123456");
    expect(cleanCode("12345")).toBeNull();
    expect(cleanCode("12345a")).toBeNull();
  });

  it("stores an HMAC, not a plain hash of the code", () => {
    const plain = createHash("sha256").update("123456").digest("hex");
    expect(hashCode("123456", SECRET)).not.toBe(plain);
    expect(hashCode("123456", SECRET)).not.toBe(hashCode("123456", "other-secret"));
  });

  it("checks the code: right, wrong, expired and out of tries", () => {
    const stored = { codeHash: hashCode("123456", SECRET), tries: 0, expiresAt: later };
    expect(checkCode(stored, "123 456", SECRET, now)).toBe("ok");
    expect(checkCode(stored, "654321", SECRET, now)).toBe("wrong");
    expect(checkCode(stored, "abc", SECRET, now)).toBe("wrong");
    expect(checkCode(stored, "123456", SECRET, later)).toBe("dead");
    expect(checkCode({ ...stored, tries: RESET_CODE_TRIES }, "123456", SECRET, now)).toBe("dead");
    expect(checkCode(null, "123456", SECRET, now)).toBe("dead");
  });
});

describe("password rules", () => {
  it("needs 8 characters and at most 72 bytes (bcrypt's limit)", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("long-enough").success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(73)).success).toBe(false);
    // 30 Sinhala letters are 90 bytes.
    expect(passwordSchema.safeParse("අ".repeat(30)).success).toBe(false);
  });
});

describe("request IP", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("takes Vercel's first x-forwarded-for entry and ignores cf-connecting-ip", () => {
    expect(requestIp(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "cf-connecting-ip": "9.9.9.9" }), true)).toBe("1.1.1.1");
  });
  it("takes the last entry elsewhere, or one shared bucket", () => {
    expect(requestIp(h({ "x-forwarded-for": "6.6.6.6, 3.3.3.3" }), false)).toBe("3.3.3.3");
    expect(requestIp(h({}), false)).toBe("unknown");
  });
});
