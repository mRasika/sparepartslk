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
  const done = new Set(applied);
  // Changes the database has that this version doesn't know (they came with a newer version).
  const newer = applied.filter((t) => !known.has(t));
  // This version's own changes the database doesn't have yet.
  const pending = journal.filter((t) => !done.has(t));
  // Drizzle's migrator only applies changes later than the database's last one: a missing change
  // older than that would be skipped without a word, so it must stop the update too.
  const last = applied.length ? Math.max(...applied) : -Infinity;
  const gap = pending.some((t) => t < last);

  let action;
  if ((newer.length && pending.length) || gap) action = "disagree";
  else if (newer.length) action = "rollback";
  else if (pending.length) action = "migrate";
  else action = "up-to-date";
  return { action, newer, pending };
}
