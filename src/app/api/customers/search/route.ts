import { getSessionUser } from "@/server/auth";
import { listCustomers } from "@/server/services/customers";

/**
 * Active customers for the picker. A GET route rather than a Server Action: actions run one at a
 * time per page, so type-ahead searches queued behind each other; fetches run in parallel and the
 * picker aborts the stale ones.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const rows = await listCustomers({ q, activeOnly: true, limit: 20 });
  return Response.json(rows, { headers: { "Cache-Control": "no-store" } });
}
