import { sql } from "drizzle-orm";
import { D, fmt } from "@/lib/money";
import type { Bucket, DateRange, Period } from "@/lib/periods";
import { requireRole, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";

export type SalesTotals = {
  /** Invoice net sales − return net amounts. Before VAT. */
  netSales: string;
  /** Invoice line costs − costs of returned items put back in stock. */
  cost: string;
  grossProfit: string;
  /** Invoice net sales only, for the average sale and the cash/credit split. */
  invoiceSales: string;
  invoiceCount: number;
  cashSales: string;
  creditSales: string;
};

export type TrendPoint = { bucketStart: string; netSales: string; grossProfit: string };

/**
 * Every sold and returned line in the range, one row each (spec §3): `net` carries the line's share
 * of the invoice discount and no VAT; returns are negative and count on their return date, and give
 * back their cost only when restocked.
 */
function saleLines(range: DateRange) {
  const share = (amount: string) =>
    sql.raw(`case when i.subtotal = 0 then 0 else ${amount} * (i.subtotal - i.discount_total) / i.subtotal end`);
  return sql`
    select i.invoice_date as d, ii.part_id, ii.qty, ${share("ii.line_total")} as net, ii.unit_cost * ii.qty as cost
    from invoice_items ii
    join invoices i on i.id = ii.invoice_id
    where i.status = 'issued' and i.invoice_date between ${range.from}::date and ${range.to}::date
    union all
    select r.return_date, ri.part_id, -ri.qty, -${share("ri.line_total")},
           -(case when ri.restock then ii.unit_cost * ri.qty else 0 end)
    from sales_return_items ri
    join sales_returns r on r.id = ri.return_id
    join invoices i on i.id = r.invoice_id
    join invoice_items ii on ii.id = ri.invoice_item_id
    where r.return_date between ${range.from}::date and ${range.to}::date
  `;
}

/** Sales, cost and profit for a date range (admin data: callers check the role). */
export async function getSalesTotals(range: DateRange): Promise<SalesTotals> {
  const [row] = await db.execute<{
    net_sales: string;
    cost: string;
    invoice_sales: string;
    invoice_count: number;
    cash_sales: string;
    credit_sales: string;
  }>(sql`
    with lines as (${saleLines(range)}),
    line_totals as (
      select coalesce(sum(net), 0)::numeric(12, 2) as net_sales, coalesce(sum(cost), 0)::numeric(12, 2) as cost
      from lines
    ),
    invoice_totals as (
      select count(*)::int as invoice_count,
             coalesce(sum(subtotal - discount_total), 0)::numeric(12, 2) as invoice_sales,
             coalesce(sum(subtotal - discount_total) filter (where payment_type = 'cash'), 0)::numeric(12, 2) as cash_sales,
             coalesce(sum(subtotal - discount_total) filter (where payment_type = 'credit'), 0)::numeric(12, 2) as credit_sales
      from invoices
      where status = 'issued' and invoice_date between ${range.from}::date and ${range.to}::date
    )
    select net_sales::text, cost::text, invoice_sales::text, invoice_count, cash_sales::text, credit_sales::text
    from line_totals, invoice_totals
  `);
  return {
    netSales: row.net_sales,
    cost: row.cost,
    grossProfit: fmt(D(row.net_sales).minus(row.cost)),
    invoiceSales: row.invoice_sales,
    invoiceCount: row.invoice_count,
    cashSales: row.cash_sales,
    creditSales: row.credit_sales,
  };
}

/** Net sales and gross profit per day, week (from Monday) or month; empty buckets are 0. */
export async function getSalesTrend(range: DateRange, bucket: Bucket): Promise<TrendPoint[]> {
  const rows = await db.execute<{ bucket_start: string; net_sales: string; gross_profit: string }>(sql`
    with lines as (${saleLines(range)}),
    buckets as (
      select generate_series(
        date_trunc(${bucket}, ${range.from}::timestamp),
        ${range.to}::timestamp,
        ('1 ' || ${bucket})::interval
      )::date as b
    ),
    sums as (
      select date_trunc(${bucket}, d::timestamp)::date as b,
             sum(net)::numeric(12, 2) as net_sales, sum(cost)::numeric(12, 2) as cost
      from lines
      group by 1
    )
    select greatest(buckets.b, ${range.from}::date)::text as bucket_start,
           coalesce(sums.net_sales, 0)::numeric(12, 2)::text as net_sales,
           coalesce(sums.net_sales - sums.cost, 0)::numeric(12, 2)::text as gross_profit
    from buckets
    left join sums on sums.b = buckets.b
    order by buckets.b
  `);
  return rows.map((r) => ({ bucketStart: r.bucket_start, netSales: r.net_sales, grossProfit: r.gross_profit }));
}

export type TopDimension = "parts" | "categories" | "brands" | "models";
export type TopSort = "sales" | "profit";
export type TopSellerRow = {
  key: string;
  name: string;
  /** The SKU for parts. */
  detail: string | null;
  qty: number;
  netSales: string;
  grossProfit: string;
};

/** How each top-sellers tab names and groups its rows; `none` gathers parts without a category or brand. */
const DIMENSIONS: Record<TopDimension, { key: string; name: string; detail: string; join: string }> = {
  parts: { key: "p.id::text", name: "p.name", detail: "p.sku", join: "" },
  categories: {
    key: "coalesce(c.id::text, 'none')",
    name: "coalesce(c.name, 'Uncategorised')",
    detail: "null",
    join: "left join categories c on c.id = p.category_id",
  },
  brands: {
    key: "coalesce(b.id::text, 'none')",
    name: "coalesce(b.name, 'No brand')",
    detail: "null",
    join: "left join brands b on b.id = p.brand_id",
  },
  // A part that fits several models counts toward each; parts with no fitment drop out.
  models: {
    key: "v.id::text",
    name: "v.make || ' ' || v.model",
    detail: "null",
    join: "join part_fitments f on f.part_id = p.id join vehicle_models v on v.id = f.vehicle_model_id",
  },
};

/** The best sellers in a range by part, category, brand or bike model, after returns. */
export async function getTopSellers(
  range: DateRange,
  dimension: TopDimension,
  sort: TopSort,
  limit = 10,
): Promise<TopSellerRow[]> {
  const dim = DIMENSIONS[dimension];
  // Sort on the numeric columns: the output columns are text, where "9000.00" > "10000.00".
  const orderBy = sort === "profit" ? "t.profit" : "t.net";
  const rows = await db.execute<{
    key: string;
    name: string;
    detail: string | null;
    qty: number;
    net_sales: string;
    gross_profit: string;
  }>(sql`
    with lines as (${saleLines(range)})
    select key, name, detail, qty, t.net::text as net_sales, t.profit::text as gross_profit
    from (
      select ${sql.raw(dim.key)} as key, ${sql.raw(dim.name)} as name, ${sql.raw(dim.detail)} as detail,
             sum(l.qty)::int as qty,
             sum(l.net)::numeric(12, 2) as net,
             (sum(l.net)::numeric(12, 2) - sum(l.cost)::numeric(12, 2)) as profit
      from lines l
      join parts p on p.id = l.part_id
      ${sql.raw(dim.join)}
      group by 1, 2, 3
    ) t
    order by ${sql.raw(orderBy)} desc, name asc
    limit ${limit}
  `);
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    detail: r.detail,
    qty: r.qty,
    netSales: r.net_sales,
    grossProfit: r.gross_profit,
  }));
}

export type SalesAnalytics = { current: SalesTotals; previous: SalesTotals; trend: TrendPoint[]; top: TopSellerRow[] };

/** Everything the dashboard's sales & profit section shows (spec §2). Admins only: it reveals cost. */
export async function getSalesAnalytics(
  user: SessionUser,
  period: Period,
  top: { dimension: TopDimension; sort: TopSort },
): Promise<SalesAnalytics> {
  requireRole(user, "admin");
  const [current, previous, trend, topRows] = await Promise.all([
    getSalesTotals(period.range),
    getSalesTotals(period.compare),
    getSalesTrend(period.range, period.bucket),
    getTopSellers(period.range, top.dimension, top.sort),
  ]);
  return { current, previous, trend, top: topRows };
}
