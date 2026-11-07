/**
 * The e2e web server: a production build of the app, then `next start`.
 *
 * - A dev server used ~3.4 GB and compiled each page on its first visit (10–20 s after a save on a
 *   busy machine), so full runs timed out or were stopped for low memory. `next start` uses far
 *   less and answers at once.
 * - It also tests what really ships: some bugs show only in production builds (see the keyed
 *   Suspense note in docs and the Node-runtime middleware).
 * - The build's data cache can hold values from the last run's database (ids, the company name),
 *   so it is cleared after the build and before the server starts.
 */
export function buildAndStart(opts: { distDir: string; port: number; env: Record<string, string> }): string {
  const env = Object.entries({ NEXT_DIST_DIR: opts.distDir, ...opts.env })
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const clearCache = `node -e "require('fs').rmSync('${opts.distDir}/cache', { recursive: true, force: true })"`;
  return `pnpm exec cross-env ${env} next build && ${clearCache} && pnpm exec cross-env ${env} next start -p ${opts.port}`;
}
