/** "1250.5" → "1,250.50". Works on the decimal string, so no float rounding. */
export function formatMoney(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const negative = value.trim().startsWith("-");
  const [int, frac = ""] = value.trim().replace(/^[-+]/, "").split(".");
  const grouped = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00`) : value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const DAY_MS = 86_400_000;

/**
 * A business date ("YYYY-MM-DD") as people say it, for lists: "Today", "6 days ago", "2 weeks ago"
 * up to 30 days back, then "7 Oct" (with the year only when it isn't `today`'s year).
 */
export function formatSince(date: string, today: string): string {
  const at = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  const days = Math.round((at(today) - at(date)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 14) return `${days} days ago`;
  if (days >= 14 && days <= 30) return `${Math.floor(days / 7)} weeks ago`;
  return formatDayMonth(date, today);
}

/** "2 Aug", or "20 Dec 2025" when the year isn't `today`'s: dates in on-screen lists. */
export function formatDayMonth(date: string, today: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  });
}

const trimZero = (x: string) => x.replace(/\.0$/, "");

/**
 * A summary amount, read at a glance: "Rs 67,600" below Rs 100,000, then "Rs 512k", "Rs 3.4M".
 * No cents. Use on summary boxes, legends and sentences, with the exact amount in a tooltip
 * (`<Amount>`); tables and documents keep exact amounts.
 */
export function formatRsShort(value: string): string {
  const n = Number(value);
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (Math.round(a) < 100_000) return `${sign}Rs ${Math.round(a).toLocaleString("en-US")}`;
  const k = Math.round(a / 1_000);
  if (k < 1_000) return `${sign}Rs ${k}k`;
  if (a < 999_950_000) return `${sign}Rs ${trimZero((a / 1_000_000).toFixed(1))}M`;
  return `${sign}Rs ${trimZero((a / 1_000_000_000).toFixed(1))}B`;
}

/**
 * Formatter for one table column of amounts: drops ".00" when every amount in the column is whole,
 * and keeps cents on every row otherwise, so the column's digits stay lined up.
 */
export function moneyColumn(values: (string | null | undefined)[]): (value: string | null | undefined) => string {
  const whole = values.every((v) => v == null || v === "" || /^-?\d+(\.0*)?$/.test(v.trim()));
  return (value) => {
    const s = formatMoney(value);
    return whole && s.endsWith(".00") ? s.slice(0, -3) : s;
  };
}

/** A span of days as people say it: "38 days", then "about 5 months", "about 1.5 years". */
export function formatDays(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 365) return `about ${Math.round(days / 30)} months`;
  const years = Math.round((days / 365) * 10) / 10;
  return `about ${years} ${years === 1 ? "year" : "years"}`;
}

export function formatDateTime(value: Date): string {
  return value.toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
