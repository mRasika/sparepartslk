import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps JSX for Next.js; tests compile it with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/setup/global-setup.ts"],
    setupFiles: ["tests/setup/env.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
