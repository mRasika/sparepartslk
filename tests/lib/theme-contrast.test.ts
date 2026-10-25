import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The `--name: #rrggbb;` tokens of the `.dark { … }` block in globals.css. */
function darkTokens(): Record<string, string> {
  const css = readFileSync("src/app/globals.css", "utf8");
  const block = css.match(/\n\.dark \{([^}]*)\}/)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text token on surface token: every pair the app draws text with.
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["destructive", "background"],
  ["destructive", "card"],
  // Warning text sits on the page and on cards (never on a solid amber fill).
  ["warning-foreground", "background"],
  ["warning-foreground", "card"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["sidebar-primary-foreground", "sidebar-primary"],
];

describe("dark theme colours", () => {
  const tokens = darkTokens();

  it("defines every token as a hex colour", () => {
    for (const [a, b] of TEXT_PAIRS) {
      expect(tokens[a], `--${a}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tokens[b], `--${b}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(TEXT_PAIRS)("keeps --%s readable on --%s (WCAG AA 4.5:1)", (text, surface) => {
    expect(contrast(tokens[text], tokens[surface])).toBeGreaterThanOrEqual(4.5);
  });
});
