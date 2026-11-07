import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";
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
  // The dev server compiles each page the first time it is opened; see playwright.config.ts.
  expect: { timeout: 30_000 },
  globalSetup: "./e2e/setup/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "setup", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    // The data cache from the last run still holds the last company's name; clear it first.
    command: `node -e "require('fs').rmSync('.next-e2e-setup/cache', { recursive: true, force: true })" && pnpm exec cross-env NEXT_DIST_DIR=.next-e2e-setup SETUP_KEY=${E2E_SETUP_KEY} DATABASE_URL=${setupDatabaseUrl()} next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
