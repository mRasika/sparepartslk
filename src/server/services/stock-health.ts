import { sql } from "drizzle-orm";
import { addDays, colomboDate } from "@/lib/dates";
import { summarizeStock, type StockHealth } from "@/lib/stock-health";
import { requireRole, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { getSalesTotals, salesByPart } from "@/server/services/sales-analytics";

/**
 * Stock value, age, ABC classes and turnover for the Stock page (spec §3). Admins only: every
 * figure uses cost.
 */
export async function getStockHealth(user: SessionUser, today: string = colomboDate()): Promise<StockHealth> {
  requireRole(user, "admin");
  const [parts, sales12, totals90] = await Promise.all([
    db.execute<{
      id: string;
      sku: string;
      name: string;
      qty_on_hand: number;
      avg_cost: string;
      reorder_level: number;
      is_active: boolean;
      last_sold: string | null;
      first_arrival: string | null;
    }>(sql`
      select p.id, p.sku, p.name, p.qty_on_hand, p.avg_cost::text, p.reorder_level, p.is_active,
             (select max(i.invoice_date)::text from invoice_items ii
                join invoices i on i.id = ii.invoice_id
               where ii.part_id = p.id and i.status = 'issued') as last_sold,
             (select min((m.created_at at time zone 'Asia/Colombo')::date)::text from stock_movements m
               where m.part_id = p.id and m.qty_change > 0) as first_arrival
      from parts p
      where p.is_active or p.qty_on_hand > 0
    `),
    salesByPart({ from: addDays(today, -364), to: today }),
    getSalesTotals({ from: addDays(today, -89), to: today }),
  ]);

  return summarizeStock({
    today,
    parts: parts.map((p) => ({
      partId: p.id,
      sku: p.sku,
      name: p.name,
      qtyOnHand: Number(p.qty_on_hand),
      avgCost: p.avg_cost,
      reorderLevel: Number(p.reorder_level),
      isActive: p.is_active,
      lastSoldOn: p.last_sold,
      firstArrivalOn: p.first_arrival,
    })),
    sales12,
    cogs90: totals90.cost,
  });
}
