import { requireRole, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { logo } from "@/server/db/schema";
import { DomainError } from "@/server/errors";

export const LOGO_MAX_BYTES = 1024 * 1024;

/**
 * The first bytes each allowed picture type must start with ([offset, bytes] pairs). PNG and JPEG
 * only: the invoice PDF can't draw WebP, so a WebP logo would vanish from PDFs.
 */
const SIGNATURES: Record<string, [number, number[]][]> = {
  "image/png": [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  "image/jpeg": [[0, [0xff, 0xd8, 0xff]]],
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
  if (!SIGNATURES[file.type] || !looksLike(file.type, file.bytes)) throw fail("Use a PNG or JPG image");
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

/** A logo the PDF library can draw. */
export type PdfLogo = { data: Buffer; format: "png" | "jpg" };

/** The pre-database logo address: a public Supabase Storage file. */
const OLD_STORAGE_LINK = /^https:\/\/[^/]+\/storage\/v1\/object\/public\//;
const DOWNLOAD_TIMEOUT_MS = 3000;

function pdfLogoFrom(data: Buffer): PdfLogo | null {
  if (looksLike("image/png", data)) return { data, format: "png" };
  if (looksLike("image/jpeg", data)) return { data, format: "jpg" };
  return null;
}

/**
 * The logo for a PDF, from the address saved in Settings: read from the database, or downloaded
 * from the old Supabase Storage link until the owner uploads the logo again. Any problem gives null,
 * so the PDF is still made, just without the logo. Other web addresses aren't fetched.
 */
export async function logoForPdf(logoUrl: string | null, fetchImpl: typeof fetch = fetch): Promise<PdfLogo | null> {
  if (!logoUrl) return null;
  try {
    if (logoUrl.startsWith("/api/logo")) {
      const stored = await readLogo();
      return stored ? pdfLogoFrom(stored.data) : null;
    }
    if (!OLD_STORAGE_LINK.test(logoUrl)) return null;
    const res = await fetchImpl(logoUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) return null;
    return pdfLogoFrom(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
