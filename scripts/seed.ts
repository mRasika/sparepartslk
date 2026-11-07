/**
 * Seeds base data (price tiers, walk-in customer, settings) and the first admin user.
 * Idempotent: safe to run again.
 *
 *   pnpm db:seed -- --admin-email owner@example.com --admin-password 'secret' [--admin-name 'Owner']
 */
import { config } from "dotenv";
import { parseArgs } from "node:util";

config({ path: ".env.local", quiet: true });

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      "admin-email": { type: "string" },
      "admin-password": { type: "string" },
      "admin-name": { type: "string", default: "Owner" },
    },
  });
  const email = values["admin-email"]?.trim().toLowerCase();
  const password = values["admin-password"];
  if (!email || !password) {
    throw new Error("Usage: pnpm db:seed -- --admin-email <email> --admin-password <password>");
  }

  // Imported after dotenv so the DB client sees DATABASE_URL.
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/server/db/client");
  const { insertBaseData } = await import("@/server/db/base-data");
  const { profiles } = await import("@/server/db/schema");
  const { createLogin } = await import("@/server/auth-admin");

  try {
    await insertBaseData(db);
    console.log("Base data ready (price tiers, walk-in customer, settings).");

    const [existing] = await db.select().from(profiles).where(eq(profiles.email, email));
    if (existing) {
      console.log(`Admin profile for ${email} already exists; nothing to do.`);
      return;
    }

    await createLogin({ email, name: values["admin-name"]!, password, role: "admin" });
    console.log(`Admin user ${email} is ready.`);
  } finally {
    await db.$client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
