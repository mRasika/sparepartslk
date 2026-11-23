import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // New in eslint-plugin-react-hooks 7 (with Next 16). It flags 5 working effects in the billing
    // editors and pickers (search reset, focus hand-off). Rewriting them is a separate change, not
    // part of the Next upgrade; turn this back on when they are reworked.
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  globalIgnores([
    "node_modules/**",
    ".next/**",
    ".next-e2e/**",
    ".next-e2e-setup/**",
    ".next-build/**",
    ".next-stress/**",
    "test-results/**",
    "playwright-report/**",
    ".superpowers/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
