// Decides what the Docker "migrate" job does, from two lists of Drizzle migration timestamps:
//   applied — created_at values in drizzle.__drizzle_migrations (what the database has)
//   journal — "when" values in drizzle/meta/_journal.json (what this version contains)
// Pure function, no I/O, so it can be unit tested (tests/services/migration-state.test.ts).

/**
 * @param {{ applied: number[], journal: number[] }} input
 * @returns {{ action: "migrate" | "rollback" | "disagree" | "up-to-date", newer: number[], pending: number[] }}
 */
export function migrationState({ applied, journal }) {
  const known = new Set(journal);
  // Changes the database has that this version doesn't know (they came with a newer version).
  const newer = applied.filter((t) => !known.has(t));
  // What Drizzle's migrator would apply: entries newer than the database's last one.
  const last = applied.length ? Math.max(...applied) : -Infinity;
  const pending = journal.filter((t) => t > last);

  let action;
  if (newer.length && pending.length) action = "disagree";
  else if (newer.length) action = "rollback";
  else if (pending.length) action = "migrate";
  else action = "up-to-date";
  return { action, newer, pending };
}
