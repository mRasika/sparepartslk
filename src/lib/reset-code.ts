import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const RESET_CODE_MINUTES = 15;
export const RESET_CODE_TRIES = 5;

/** The only answer to "send me a code", whether or not anything was sent (no one learns who has a login). */
export const CODE_SENT_ANSWER = `If this email can get codes, we sent a 6-digit code to it. It works for ${RESET_CODE_MINUTES} minutes.`;

/** The only answer to a code that can't be used, whatever the reason. */
export const CODE_FAILED = "The code is wrong or too old. Ask for a new code.";

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/** Six digits from a cryptographic random source, leading zeros kept. */
export function makeCode(random: (max: number) => number = (max) => randomInt(0, max)): string {
  return String(random(1_000_000)).padStart(6, "0");
}

/** Accepts "123 456" or "123-456"; anything that isn't 6 digits is null (and still costs a try). */
export function cleanCode(typed: string): string | null {
  const digits = typed.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** HMAC, not a plain hash: a plain hash of 6 digits is undone by trying all million. */
export function hashCode(code: string, secret: string): string {
  return createHmac("sha256", `password-reset-code:${secret}`).update(code).digest("hex");
}

export type StoredCode = { codeHash: string; tries: number; expiresAt: Date };

/** "ok" right code · "wrong" costs a try · "dead" no code, expired or out of tries. */
export function checkCode(stored: StoredCode | null, typed: string, secret: string, now: Date): "ok" | "wrong" | "dead" {
  if (!stored || stored.expiresAt.getTime() <= now.getTime() || stored.tries >= RESET_CODE_TRIES) return "dead";
  const code = cleanCode(typed);
  if (!code) return "wrong";
  const a = Buffer.from(hashCode(code, secret), "hex");
  const b = Buffer.from(stored.codeHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "wrong";
}
