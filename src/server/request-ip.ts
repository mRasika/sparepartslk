/**
 * The visitor's IP, only for per-device limits. On Vercel the platform writes x-forwarded-for itself,
 * so its first entry is the visitor. Elsewhere (local dev, tests) the last entry is the one the nearest
 * proxy added. Never trust a header the visitor could type, so no cf-connecting-ip.
 */
export function requestIp(headers: Headers, onVercel = Boolean(process.env.VERCEL)): string {
  const fwd = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const found = onVercel ? fwd[0] || headers.get("x-real-ip")?.trim() : fwd.at(-1);
  return found || "unknown";
}
