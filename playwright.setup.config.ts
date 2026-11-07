import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";
import { buildAndStart } from "./e2e/server-command";
import { E2E_SETUP_KEY, setupDatabaseUrl } from "./e2e/setup-db";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test", override: true, quiet: true });

const PORT = 3101;

/** A brand-new company: its own server on an empty database, to walk through /setup. */
export default defineConfig({
  testDir: "./e2e/setup",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  globalSetup: "./e2e/setup/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "setup", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: buildAndStart({
      distDir: ".next-e2e-setup",
      port: PORT,
      env: { SETUP_KEY: E2E_SETUP_KEY, DATABASE_URL: setupDatabaseUrl() },
    }),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: process.env.E2E_SERVER_LOG ? "pipe" : "ignore",
  },
});
