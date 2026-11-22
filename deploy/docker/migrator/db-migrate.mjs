// The database update step of the Docker "migrate" job (called by deploy/docker/bin/migrate).
// Prints exactly one result line for the shell script to read:
//   MIGRATED <n>         applied n migrations                                   exit 0
//   UP-TO-DATE           nothing to apply                                       exit 0
//   ROLLBACK newer=<…>   database is newer than this version: left as it is     exit 0
//   DISAGREE newer=<…> pending=<…>   database and this version disagree         exit 3
// A failed migration exits 1. Drizzle applies all pending migrations in ONE transaction, so a
// failure leaves the database exactly as it was (no "half-finished migration" state).
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { migrationState } from "./migration-state.mjs";

const url = process.env.DATABASE_URL;
const folder = process.env.MIGRATIONS_DIR || "/tools/drizzle";
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")).entries.map((e) => e.when);
const sql = postgres(url, { max: 1, onnotice: () => {} });

let code = 0;
try {
  const [{ exists }] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  const applied = exists
    ? (await sql`select created_at from drizzle.__drizzle_migrations`).map((r) => Number(r.created_at))
    : [];
  const state = migrationState({ applied, journal });

  if (state.action === "disagree") {
    console.log(`DISAGREE newer=${state.newer.join(",")} pending=${state.pending.join(",")}`);
    code = 3;
  } else if (state.action === "rollback") {
    console.log(`ROLLBACK newer=${state.newer.join(",")}`);
  } else if (state.action === "up-to-date") {
    console.log("UP-TO-DATE");
  } else {
    await migrate(drizzle(sql), { migrationsFolder: folder });
    console.log(`MIGRATED ${state.pending.length}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(code);
