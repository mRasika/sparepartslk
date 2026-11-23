/**
 * Rules for scanning a part into a line list with a barcode scanner (which types the code, then
 * Enter). A scan picks a part only on a unique exact match of SKU or barcode; OEM numbers are not
 * unique, so they never count.
 */

/** Rows whose SKU or barcode equals the code, ignoring case and surrounding spaces. */
export function findExactMatches<T extends { sku: string; barcode?: string | null }>(rows: T[], code: string): T[] {
  const c = code.trim().toLowerCase();
  if (!c) return [];
  return rows.filter((r) => r.sku.toLowerCase() === c || r.barcode?.toLowerCase() === c);
}

/**
 * The quantity after scanning a part that is already on a line: one more, or for a negative stock
 * change one further from zero. A value that isn't a whole number is left for the user to fix.
 */
export function bumpQty(qty: string): string {
  const q = qty.trim();
  if (!q) return "1";
  if (!/^-?\d+$/.test(q)) return qty;
  const n = Number(q);
  return String(n < 0 ? n - 1 : n + 1);
}

/** The search a scan runs. It never carries the finder's category or bike filters. */
export function scanLookupUrl(code: string, customerId?: string): string {
  const params = new URLSearchParams({ q: code });
  if (customerId) params.set("customerId", customerId);
  return `/api/parts/search?${params}`;
}

/** Why a scan added nothing: no such code, signed out, or the lookup itself failed. */
export type ScanProblem = "unknown" | "signed-out" | "failed";

/** What a lookup response that isn't OK means. */
export function lookupProblem(status: number): Exclude<ScanProblem, "unknown"> {
  return status === 401 ? "signed-out" : "failed";
}

/** The message under the finder for a scan that added nothing. */
export function scanProblemText(problem: ScanProblem, code: string): string {
  switch (problem) {
    case "unknown":
      return `No part with code “${code}”`;
    case "signed-out":
      // Signing in on this page would lose the unsaved lines; another tab shares the sign-in.
      return `“${code}” not added: you are signed out. Sign in again in another tab, then scan it again.`;
    case "failed":
      return `Couldn’t look up “${code}”. Check the connection and scan it again.`;
  }
}

/**
 * Applies results in the order they were asked for. Quick scans of different parts look up at
 * the same time and can come back in any order; each scan's lines still go in in scan order.
 */
export function createInOrder() {
  let tail: Promise<void> = Promise.resolve();
  let waiting = 0;
  return {
    /** True while an added result has not been applied yet. */
    get busy() {
      return waiting > 0;
    },
    /** Runs `apply` with the result once every earlier one has been applied. */
    add<T>(result: Promise<T>, apply: (value: T) => void): Promise<void> {
      waiting++;
      tail = tail
        .then(() => result)
        .then(apply)
        // One failed step must not hold up the scans after it.
        .catch((e: unknown) => console.error("Scan step failed", e))
        .finally(() => {
          waiting--;
        });
      return tail;
    },
  };
}
