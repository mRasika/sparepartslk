/**
 * Loads realistic demo data into the LOCAL database for testing (pnpm db:seed-demo).
 * Refuses to run unless DATABASE_URL points at this machine, so it can never touch staging or production.
 * Run `pnpm db:seed` first (it creates the admin login this uses).
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to load demo data into a non-local database (${host}). Demo data is for local testing only.`);
  }

  const { and, asc, eq } = await import("drizzle-orm");
  const { db } = await import("@/server/db/client");
  const { profiles } = await import("@/server/db/schema");
  const { loadDemoData } = await import("./demo-data");

  try {
    const pick = async (role: "admin" | "staff") => {
      const [p] = await db
        .select()
        .from(profiles)
        .where(and(eq(profiles.role, role), eq(profiles.isActive, true)))
        .orderBy(asc(profiles.createdAt))
        .limit(1);
      return p ? { id: p.userId, email: p.email, fullName: p.fullName, role: p.role } : null;
    };
    const admin = await pick("admin");
    if (!admin) throw new Error("No active admin found. Run pnpm db:seed first.");
    const staff = (await pick("staff")) ?? admin;

    const result = await loadDemoData({ admin, staff });
    console.log(result.message);
    if (result.loaded) console.log(`Past documents are recorded by ${admin.fullName}; today's by ${staff.fullName}.`);
  } finally {
    await db.$client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
