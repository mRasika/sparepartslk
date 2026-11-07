import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";
import { buildAndStart } from "./e2e/server-command";

config({ path: ".env.local", quiet: true });
config({ path: ".env.test", override: true, quiet: true });

const PORT = 3100;

// The brand-new-company walk-through (e2e/setup) has its own config and server
// (playwright.setup.config.ts), run after this one, so only one server runs at a time.
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "setup/**",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // Uses the installed Google Chrome, so no browser download is needed.
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    // A production build on its own port and folder, pointed at the test database, so it never
    // touches dev data. Emails are written to .e2e-outbox instead of sent.
    command: buildAndStart({
      distDir: ".next-e2e",
      port: PORT,
      env: {
        FEATURE_SALES_TARGET: "1",
        EMAIL_OUTBOX_DIR: ".e2e-outbox",
        DATABASE_URL: process.env.TEST_DATABASE_URL!,
      },
    }),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    // The build comes first: allow it a few minutes.
    timeout: 600_000,
    stdout: process.env.E2E_SERVER_LOG ? "pipe" : "ignore",
  },
});
