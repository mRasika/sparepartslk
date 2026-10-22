/** Shown when a staff user opens an admin-only page. */
export function NoAccess({ what = "this page" }: { what?: string }) {
  return (
    <div role="alert" className="max-w-lg rounded-lg border bg-card p-6">
      <h1 className="text-lg font-semibold">Admins only</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You need an admin account to open {what}. Ask the owner if you need access.
      </p>
    </div>
  );
}
