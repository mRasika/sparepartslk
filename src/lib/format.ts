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
  return new Date(at(date)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
    timeZone: "UTC",
  });
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
