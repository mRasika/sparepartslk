import { readLogo } from "@/server/services/logo";

/**
 * The company logo. Signed-in users only (the middleware guards it like every page). The `?v=` in
 * the address changes on every upload, so the long cache never shows an old logo.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const stored = await readLogo();
  if (!stored) return new Response("No logo", { status: 404 });
  return new Response(new Uint8Array(stored.data), {
    headers: {
      "Content-Type": stored.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
