import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test", override: true, quiet: true });

const PORT = 3100;

// The brand-new-company walk-through (e2e/setup) has its own config and server
// (playwright.setup.config.ts), run after this one: two dev servers at once ran this machine out
// of memory and made server actions time out.
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "setup/**",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  // The dev server compiles each page the first time a spec opens it (often right after a save),
  // which took 10–20 s on a busy machine; 15 s timed out saves that had worked.
  expect: { timeout: 30_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // Uses the installed Google Chrome, so no browser download is needed.
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    // Its own port and build folder, pointed at the test database, so it never touches dev data.
    // Emails are written to .e2e-outbox instead of sent.
    // global-setup rebuilds that database every run, so the data cache (cached tier, category
    // lists) from the last run is cleared first: its ids no longer exist.
    command: `node -e "require('fs').rmSync('.next-e2e/cache', { recursive: true, force: true })" && pnpm exec cross-env NEXT_DIST_DIR=.next-e2e FEATURE_SALES_TARGET=1 EMAIL_OUTBOX_DIR=.e2e-outbox DATABASE_URL=${process.env.TEST_DATABASE_URL} next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: process.env.E2E_SERVER_LOG ? "pipe" : "ignore",
  },
});
