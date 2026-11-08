/**
 * "Is the app running?" — answers ok without touching the database or needing a login.
 * Used by Docker's health check and uptime monitors.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response("ok", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
