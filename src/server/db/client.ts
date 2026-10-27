import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { traceQueries } from "./trace";

function databaseUrl(): string {
  const url = process.env.VITEST ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) {
    throw new Error(process.env.VITEST ? "TEST_DATABASE_URL is not set" : "DATABASE_URL is not set");
  }
  return url;
}

// Reuse one pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { pgClient?: postgres.Sql };

const client =
  globalForDb.pgClient ??
  postgres(databaseUrl(), {
    max: 10,
    // Required by the Supabase transaction pooler; harmless on a direct connection.
    prepare: false,
    // A Vercel instance can be frozen between requests, and a pooled connection kept across that may
    // be dead afterwards: a query sent on it waits forever. Close idle connections soon, recycle the
    // rest, and give up on a connect that hangs.
    idle_timeout: 20,
    max_lifetime: 60 * 5,
    connect_timeout: 10,
    onnotice: () => {},
    // Which connection each query is written to (preview only, see ./trace).
    debug: traceQueries
      ? (connection: number, query: string) =>
          console.log(`[db-trace] sent on connection ${connection}: ${query.replace(/\s+/g, " ").slice(0, 80)}`)
      : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;
