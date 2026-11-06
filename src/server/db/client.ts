import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

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
    // DATABASE_URL must be Supavisor's session pooler (port 5432): the transaction pooler (6543)
    // loses pipelined queries, which hung the dashboard on Vercel. Session mode caps the total
    // number of client connections and each Vercel instance holds up to `max`, so keep it low.
    max: 4,
    // Required by the Supabase transaction pooler; harmless on a direct connection.
    prepare: false,
    // Serverless instances come and go: close idle connections soon, recycle the rest, and give up
    // on a connect that hangs.
    idle_timeout: 20,
    max_lifetime: 60 * 5,
    connect_timeout: 10,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;
