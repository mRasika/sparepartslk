import { toCsv } from "@/lib/csv";
import { colomboDate } from "@/lib/dates";
import { getSessionUser } from "@/server/auth";
import { lowStock } from "@/server/services/inventory";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });

  const rows = await lowStock();
  const csv = toCsv(
    ["SKU", "OEM No", "Name", "On Hand", "Reorder Level", "Suggested Qty", "Last Supplier"],
    rows.map((r) => [r.sku, r.oemPartNo, r.name, r.qtyOnHand, r.reorderLevel, r.suggestedQty, r.lastSupplierName]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=low-stock-${colomboDate()}.csv`,
      "Cache-Control": "no-store",
    },
  });
}
