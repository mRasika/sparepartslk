import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;

/**
 * Counts one more use of `key` and says whether it is still within `max` per window. One SQL
 * statement, so requests arriving at the same moment are all counted (a read then a write would let
 * them all see the same count). Fixed window: the row keeps the window's start.
 */
export async function takeLimit(key: string, max: number, windowMs: number, now = new Date()): Promise<boolean> {
  // Raw SQL gets the times as text (postgres-js only converts Dates in typed Drizzle queries).
  const at = now.toISOString();
  const fresh = new Date(now.getTime() - windowMs).toISOString();
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, count, window_start) values (${key}, 1, ${at}::timestamptz)
    on conflict (key) do update set
      count = case when rate_limits.window_start <= ${fresh}::timestamptz then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start <= ${fresh}::timestamptz then ${at}::timestamptz else rate_limits.window_start end
    returning count`);
  return Number(rows[0]?.count ?? Infinity) <= max;
}
