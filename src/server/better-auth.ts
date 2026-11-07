import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { hashPassword, verifyPassword } from "@/lib/password-hash";
import { db } from "@/server/db/client";
import { account, session, user, verification } from "@/server/db/schema";

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters");
  return value;
}

const DAY = 60 * 60 * 24;

/**
 * Logins and sessions in the app's own Postgres. Email + password only; nobody can sign up (logins
 * are made by an admin through src/server/auth-admin.ts). There is no /api/auth route: every call
 * goes through `auth.api.*` from server code.
 */
export const auth = betterAuth({
  secret: secret(),
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 72,
    password: { hash: hashPassword, verify: verifyPassword },
  },
  session: {
    expiresIn: 30 * DAY,
    updateAge: DAY,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: { database: { generateId: "uuid" } },
  plugins: [nextCookies()],
});
