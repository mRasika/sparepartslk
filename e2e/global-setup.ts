import { rmSync } from "node:fs";
import { config } from "dotenv";
import { insertBaseData } from "../src/server/db/base-data";
import { freshDatabase } from "./fresh-database";
import { E2E_OUTBOX, E2E_USERS } from "./users";

/**
 * Fresh test database for every e2e run: create if missing, migrate, empty every table,
 * re-seed base data, and create the test logins (Better Auth tables, via createLogin).
 */
export default async function globalSetup() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env.test", override: true, quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  rmSync(E2E_OUTBOX, { recursive: true, force: true });

  const { client, db } = await freshDatabase(url);
  try {
    await insertBaseData(db);
    // auth-admin imports the shared db client, which reads DATABASE_URL when it is first loaded.
    process.env.DATABASE_URL = url;
    const { createLogin } = await import("../src/server/auth-admin");
    for (const u of Object.values(E2E_USERS)) {
      await createLogin({
        email: u.email,
        name: u.fullName,
        password: u.password,
        role: u.role,
        canGetEmails: u === E2E_USERS.reset,
      });
    }
  } finally {
    await client.end();
  }
}
