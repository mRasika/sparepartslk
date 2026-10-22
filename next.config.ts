import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the e2e server build into its own folder while `pnpm dev` keeps running.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // @react-pdf/renderer ships its own font/layout engines; keep it out of the server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
