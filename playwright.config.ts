import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";
import { E2E_SETUP_KEY, setupDatabaseUrl } from "./e2e/setup-db";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test", override: true, quiet: true });

const PORT = 3100;
const SETUP_PORT = 3101;
const chrome = { ...devices["Desktop Chrome"], channel: "chrome" };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: {
    trace: "retain-on-failure",
  },
  // Uses the installed Google Chrome, so no browser download is needed.
  projects: [
    { name: "chrome", testIgnore: "setup/**", use: { ...chrome, baseURL: `http://localhost:${PORT}` } },
    // A brand-new company: its own server on an empty database, to walk through /setup.
    { name: "setup", testMatch: "setup/**", use: { ...chrome, baseURL: `http://localhost:${SETUP_PORT}` } },
  ],
  webServer: [
    {
      // Its own port and build folder, pointed at the test database, so it never touches dev data.
      // Emails are written to .e2e-outbox instead of sent.
      // global-setup rebuilds that database every run, so the data cache (cached tier, category
      // lists) from the last run is cleared first: its ids no longer exist.
      command: `node -e "require('fs').rmSync('.next-e2e/cache', { recursive: true, force: true })" && pnpm exec cross-env NEXT_DIST_DIR=.next-e2e FEATURE_SALES_TARGET=1 EMAIL_OUTBOX_DIR=.e2e-outbox DATABASE_URL=${process.env.TEST_DATABASE_URL} next dev -p ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `node -e "require('fs').rmSync('.next-e2e-setup/cache', { recursive: true, force: true })" && pnpm exec cross-env NEXT_DIST_DIR=.next-e2e-setup EMAIL_OUTBOX_DIR=.e2e-outbox SETUP_KEY=${E2E_SETUP_KEY} DATABASE_URL=${setupDatabaseUrl()} next dev -p ${SETUP_PORT}`,
      url: `http://localhost:${SETUP_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
