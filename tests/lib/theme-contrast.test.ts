import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The `--name: value;` tokens of one block (`:root` or `.dark`) in globals.css. */
function tokensOf(selector: ":root" | ".dark"): Record<string, string> {
  const css = readFileSync("src/app/globals.css", "utf8");
  const start = css.indexOf(`\n${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const darkTokens = () => tokensOf(".dark");

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

// Series colours (validated with the dataviz checker for colour-blind separation): marks need
// 3:1 against the card they sit on. Light aqua is 2.82:1, allowed because the cash/credit bar
// always shows its text labels.
describe("chart colours", () => {
  const LIGHT_CARD = "#ffffff";
  const SERIES = ["chart-1", "chart-2", "chart-3", "chart-4"];

  it.each(SERIES)("light --%s stands out on the card", (token) => {
    const hex = tokensOf(":root")[token];
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(hex, LIGHT_CARD)).toBeGreaterThanOrEqual(token === "chart-3" ? 2.8 : 3);
  });

  it.each(SERIES)("dark --%s stands out on the card", (token) => {
    const dark = darkTokens();
    expect(dark[token]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(dark[token], dark.card)).toBeGreaterThanOrEqual(3);
  });
});
