import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { searchParts } from "@/server/services/catalog";
import { lookupPrices } from "@/server/services/pricing";

/**
 * Active parts for the part picker (billing, GRN, adjustments). With `customerId`, each row carries
 * the price that customer would pay (absent when the part has no price). A GET route rather than a
 * Server Action so type-ahead searches run in parallel and stale ones can be aborted.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });

  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const customerId = params.get("customerId");
  const headers = { "Cache-Control": "no-store" };

  if (!customerId) {
    return Response.json(await searchParts(q, { activeOnly: true, limit: 12 }), { headers });
  }

  if (!z.uuid().safeParse(customerId).success) return new Response("Customer not found", { status: 404 });
  const [customer] = await db
    .select({ tierId: customers.tierId })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!customer) return new Response("Customer not found", { status: 404 });

  const rows = await searchParts(q, { activeOnly: true, limit: 12 });
  const prices = await lookupPrices(db, customer.tierId, rows.map((r) => r.id));
  return Response.json(
    rows.map((r) => ({ ...r, price: prices.get(r.id) })),
    { headers },
  );
}
