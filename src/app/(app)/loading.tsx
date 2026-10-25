/**
 * Shown the moment a link is clicked while the next page renders on the server, so navigation
 * feels instant. Next also prefetches up to this boundary for links in view.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse">
      <div className="mb-6 h-8 w-48 rounded-md bg-muted" />
      <div className="mb-4 flex gap-2">
        <div className="h-9 w-64 rounded-md bg-muted" />
        <div className="h-9 w-32 rounded-md bg-muted" />
      </div>
      <div className="rounded-lg border bg-card">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-4 flex-1 rounded bg-muted" />
            <div className="h-4 w-20 rounded bg-muted" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
