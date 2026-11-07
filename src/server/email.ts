import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type Email = { to: string; subject: string; text: string };
export type SendResult = { ok: true } | { ok: false; error: string };
export type SendEmail = (email: Email) => Promise<SendResult>;

/**
 * Local and test copies can set EMAIL_OUTBOX_DIR: emails are written there as files and never sent,
 * so a test copy can't email a real person. Ignored on Vercel production.
 */
function outboxDir(): string | null {
  if (process.env.VERCEL_ENV === "production") return null;
  return process.env.EMAIL_OUTBOX_DIR || null;
}

/** Email works when Resend is set up (key and sender), or a local outbox folder is set. */
export function emailIsSetUp(): boolean {
  return Boolean(outboxDir() || (process.env.RESEND_API_KEY && process.env.EMAIL_FROM));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sends one email. Never throws and never logs the body (it can hold a code). */
export const sendEmail: SendEmail = async (email) => {
  const dir = outboxDir();
  if (dir) {
    try {
      await mkdir(dir, { recursive: true });
      const file = `${Date.now()}-${email.to.replace(/[^a-z0-9@.-]/gi, "_")}.json`;
      await writeFile(path.join(dir, file), JSON.stringify(email, null, 2));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `outbox: ${(e as Error).message}` };
    }
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "email is not set up" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.5">${escapeHtml(email.text).replace(/\n/g, "<br>")}</div>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Resend: ${(e as Error).message}` };
  }
};
