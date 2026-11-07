import { requireRole, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { logo } from "@/server/db/schema";
import { DomainError } from "@/server/errors";

export const LOGO_MAX_BYTES = 1024 * 1024;

/** The first bytes each allowed picture type must start with ([offset, bytes] pairs). */
const SIGNATURES: Record<string, [number, number[]][]> = {
  "image/png": [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  "image/jpeg": [[0, [0xff, 0xd8, 0xff]]],
  "image/webp": [
    [0, [0x52, 0x49, 0x46, 0x46]],
    [8, [0x57, 0x45, 0x42, 0x50]],
  ],
};

function looksLike(type: string, bytes: Uint8Array): boolean {
  const parts = SIGNATURES[type];
  return Boolean(parts?.every(([at, sig]) => sig.every((b, i) => bytes[at + i] === b)));
}

/** The address pages use for the logo; `v` changes on every upload so browsers fetch the new one. */
export function logoUrlFor(updatedAt: Date): string {
  return `/api/logo?v=${updatedAt.getTime()}`;
}

/**
 * Stores the company logo (replacing any earlier one). Admin only. The type is checked against the
 * file's own first bytes, so a renamed SVG or HTML file is refused.
 */
export async function saveLogo(user: SessionUser, file: { type: string; bytes: Uint8Array }): Promise<{ url: string }> {
  requireRole(user, "admin");
  const fail = (message: string) => new DomainError("Validation", message, { field: "logo" });
  if (file.bytes.length === 0) throw fail("Choose an image");
  if (!SIGNATURES[file.type] || !looksLike(file.type, file.bytes)) throw fail("Use a PNG, JPG or WebP image");
  if (file.bytes.length > LOGO_MAX_BYTES) throw fail("Keep the logo under 1 MB");

  const row = { id: 1, contentType: file.type, data: Buffer.from(file.bytes), updatedAt: new Date() };
  const [saved] = await db
    .insert(logo)
    .values(row)
    .onConflictDoUpdate({ target: logo.id, set: { contentType: row.contentType, data: row.data, updatedAt: row.updatedAt } })
    .returning({ updatedAt: logo.updatedAt });
  return { url: logoUrlFor(saved.updatedAt) };
}

/** The stored logo, or null when the company has none. */
export async function readLogo(): Promise<{ contentType: string; data: Buffer; updatedAt: Date } | null> {
  const [row] = await db
    .select({ contentType: logo.contentType, data: logo.data, updatedAt: logo.updatedAt })
    .from(logo);
  return row ?? null;
}
