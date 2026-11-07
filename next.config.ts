import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker build sets NEXT_OUTPUT=standalone for a small, self-contained server.
  // Vercel and local builds leave it unset, so they don't change.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Lets the e2e server build into its own folder while `pnpm dev` keeps running.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // @react-pdf/renderer ships its own font/layout engines; keep it out of the server bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
  // A logo can be up to 1 MB; the form adds a little on top of the file.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // Basic browser protections for every page and file.
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          // Pages can't be shown inside another website (protects against click-jacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Browsers must trust the declared file type (a PNG is a PNG, not a script).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Links to other sites don't reveal page addresses with customer or invoice ids.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app never needs the camera, microphone or location.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Always use HTTPS once the site has been visited over HTTPS (ignored on http://localhost).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ]);
  },
  // pdfkit loads its built-in fonts through `#standard-fonts/*` subpath imports, which file tracing
  // doesn't follow, so the deployed PDF route crashed with "Cannot find module .../Helvetica.cjs".
  outputFileTracingIncludes: {
    "/api/invoices/**": ["./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/**/*"],
  },
};

export default nextConfig;
