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
  const { createSupabaseAdminClient } = await import("@/server/supabase");

  try {
    await insertBaseData(db);
    console.log("Base data ready (price tiers, walk-in customer, settings).");

    const [existing] = await db.select().from(profiles).where(eq(profiles.email, email));
    if (existing) {
      console.log(`Admin profile for ${email} already exists; nothing to do.`);
      return;
    }

    const supabase = createSupabaseAdminClient();
    let userId: string | undefined;
    const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.data.user) {
      userId = created.data.user.id;
    } else {
      // The auth user may already exist from an earlier partial run.
      const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      if (!userId) throw created.error ?? new Error("Could not create the admin auth user");
    }

    await db
      .insert(profiles)
      .values({ userId, email, fullName: values["admin-name"]!, role: "admin" })
      .onConflictDoNothing();
    console.log(`Admin user ${email} is ready.`);
  } finally {
    await db.$client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
