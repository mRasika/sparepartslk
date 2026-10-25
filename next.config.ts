import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the e2e server build into its own folder while `pnpm dev` keeps running.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // @react-pdf/renderer ships its own font/layout engines; keep it out of the server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
  // pdfkit loads its built-in fonts through `#standard-fonts/*` subpath imports, which file tracing
  // doesn't follow, so the deployed PDF route crashed with "Cannot find module .../Helvetica.cjs".
  outputFileTracingIncludes: {
    "/api/invoices/**": ["./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/**/*"],
  },
};

export default nextConfig;
