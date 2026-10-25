import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { searchParts } from "@/server/services/catalog";
import { lookupPrices } from "@/server/services/pricing";

const uuidOrNone = (v: string | null) => (v && z.uuid().safeParse(v).success ? v : undefined);

/**
 * Active parts for the part picker (billing, GRN, adjustments). `categoryId` / `vehicleModelId`
 * narrow the search, and with an empty `q` they browse. With `customerId`, each row carries the
 * price that customer would pay (absent when the part has no price). A GET route rather than a
 * Server Action so type-ahead searches run in parallel and stale ones can be aborted.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });

  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const filters = {
    categoryId: uuidOrNone(params.get("categoryId")),
    vehicleModelId: uuidOrNone(params.get("vehicleModelId")),
  };
  const browsing = !q.trim();
  if (browsing && !filters.categoryId && !filters.vehicleModelId) return Response.json([]);
  const search = () => searchParts(q, { ...filters, activeOnly: true, limit: browsing ? 50 : 12 });
  const headers = { "Cache-Control": "no-store" };

  const customerId = params.get("customerId");
  if (!customerId) return Response.json(await search(), { headers });

  if (!z.uuid().safeParse(customerId).success) return new Response("Customer not found", { status: 404 });
  const [[customer], rows] = await Promise.all([
    db.select({ tierId: customers.tierId }).from(customers).where(eq(customers.id, customerId)),
    search(),
  ]);
  if (!customer) return new Response("Customer not found", { status: 404 });

  const prices = await lookupPrices(db, customer.tierId, rows.map((r) => r.id));
  return Response.json(
    rows.map((r) => ({ ...r, price: prices.get(r.id) })),
    { headers },
  );
}
