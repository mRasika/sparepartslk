/**
 * Stands in for a list's table while a search or filter loads, so only the table area changes and
 * the page header and search form stay put.
 */
export function TableSkeleton({ label = "Loading", rows = 8 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="animate-pulse rounded-lg border bg-card">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-4 flex-1 rounded bg-muted" />
          <div className="h-4 w-20 rounded bg-muted" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
