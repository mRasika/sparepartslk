/** Escapes `\`, `%` and `_` so user text matches literally inside LIKE / ILIKE patterns. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
