import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { insertBaseData } from "../src/server/db/base-data";
import * as schema from "../src/server/db/schema";
import { E2E_USERS } from "./users";

/**
 * Fresh test database for every e2e run: create if missing, migrate, empty every table,
 * re-seed base data, and make sure the admin/staff logins exist in local Supabase Auth.
 */
export default async function globalSetup() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env.test", override: true, quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");

  const adminUrl = new URL(url);
  const dbName = decodeURIComponent(adminUrl.pathname.slice(1));
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  if ((await admin`select 1 from pg_database where datname = ${dbName}`).length === 0) {
    await admin.unsafe(`create database "${dbName}"`);
  }
  await admin.end();

  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    const tables = await client<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
    await client.unsafe(`truncate table ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`);
    await insertBaseData(db);

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: existing, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    for (const u of Object.values(E2E_USERS)) {
      let id = existing.users.find((x) => x.email === u.email)?.id;
      if (id) {
        await supabase.auth.admin.updateUserById(id, { password: u.password });
      } else {
        const created = await supabase.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true });
        if (created.error || !created.data.user) throw created.error ?? new Error(`Could not create ${u.email}`);
        id = created.data.user.id;
      }
      await db.insert(schema.profiles).values({ userId: id, email: u.email, fullName: u.fullName, role: u.role });
    }
  } finally {
    await client.end();
  }
}
