/**
 * The visitor's IP, only for per-device limits.
 *
 * - With `CLIENT_IP_HEADER` set (Docker sets `cf-connecting-ip`), that header is the visitor when it
 *   is on the request. Set it ONLY where nothing but that proxy can reach the app — in the Docker
 *   stack the app has no open port and only the stack's own Cloudflare tunnel talks to it — or a
 *   visitor could type the header and get a fresh limit on every try.
 * - On Vercel the platform writes x-forwarded-for itself, so its first entry is the visitor.
 * - Elsewhere (local dev, tests) the last entry is the one the nearest proxy added.
 */
export function requestIp(
  headers: Headers,
  onVercel = Boolean(process.env.VERCEL),
  clientIpHeader = process.env.CLIENT_IP_HEADER,
): string {
  const fromProxy = clientIpHeader ? headers.get(clientIpHeader)?.trim() : undefined;
  if (fromProxy) return fromProxy;
  const fwd = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const found = onVercel ? fwd[0] || headers.get("x-real-ip")?.trim() : fwd.at(-1);
  return found || "unknown";
}
