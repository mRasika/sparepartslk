// TEMPORARY: finds which dashboard data call never finishes on Vercel (the dashboard timed out after
// 300 s there while the same calls finish in seconds elsewhere). Preview deployments only; remove
// before the next production release.
export const traceQueries = process.env.VERCEL_ENV === "preview";

let seq = 0;

/** Logs when `promise` starts and settles, and every 10 s while it is still pending. */
export function traced<T>(label: string, promise: Promise<T>): Promise<T> {
  if (!traceQueries) return promise;
  const id = ++seq;
  const t0 = Date.now();
  console.log(`[db-trace] #${id} start ${label}`);
  const waiting = setInterval(() => console.log(`[db-trace] #${id} STILL WAITING ${label} ${Date.now() - t0} ms`), 10_000);
  return promise.finally(() => {
    clearInterval(waiting);
    console.log(`[db-trace] #${id} end ${label} ${Date.now() - t0} ms`);
  });
}
