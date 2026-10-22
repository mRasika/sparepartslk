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
