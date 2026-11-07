import { config } from "dotenv";
import { freshDatabase } from "../fresh-database";
import { setupDatabaseUrl } from "../setup-db";

/** A brand-new company: the setup database is migrated and left completely empty. */
export default async function globalSetup() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env.test", override: true, quiet: true });
  const { client } = await freshDatabase(setupDatabaseUrl());
  await client.end();
}
