import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @react-pdf/renderer ships its own font/layout engines; keep it out of the server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
