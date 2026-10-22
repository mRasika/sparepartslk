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
    max: 10,
    // Required by the Supabase transaction pooler; harmless on a direct connection.
    prepare: false,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;
