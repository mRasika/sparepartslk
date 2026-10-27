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
    // No more than the Supabase pooler holds for us (5 server connections): with 10, a dashboard
    // load opened ~10 connections at once and the queries on the last ones never got an answer, so
    // the page hung until Vercel's 300 s limit. Extra queries now wait here instead.
    max: 4,
    // Required by the Supabase transaction pooler; harmless on a direct connection.
    prepare: false,
    // Serverless instances come and go: close idle connections soon, recycle the rest, and give up
    // on a connect that hangs.
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
