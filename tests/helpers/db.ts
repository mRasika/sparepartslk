import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { insertBaseData } from "@/server/db/base-data";
import { db } from "@/server/db/client";
import * as schema from "@/server/db/schema";

const tableNames = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .map((t) => `"${getTableConfig(t).name}"`);

/** Empties every app table and re-inserts the default tiers, walk-in customer and settings. */
export async function resetDb(): Promise<void> {
  await db.execute(sql.raw(`truncate table ${tableNames.join(", ")} restart identity cascade`));
  await insertBaseData(db);
}

/** Resolves to the Postgres error code the promise rejects with (drizzle wraps it in `cause`). */
export async function pgErrorCode(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
  throw new Error("Expected the query to fail");
}
