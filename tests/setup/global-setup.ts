import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Creates the test database if missing, then applies all migrations to it. */
export default async function setup() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env.test", override: true, quiet: true });

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");

  const adminUrl = new URL(url);
  const dbName = decodeURIComponent(adminUrl.pathname.slice(1));
  adminUrl.pathname = "/postgres";

  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (existing.length === 0) await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}
