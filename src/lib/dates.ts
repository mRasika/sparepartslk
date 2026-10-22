export const BUSINESS_TIME_ZONE = "Asia/Colombo";

const colomboFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Business date (YYYY-MM-DD) in Colombo time. */
export function colomboDate(at: Date = new Date()): string {
  return colomboFormatter.format(at);
}

export function colomboYear(at: Date = new Date()): number {
  return Number(colomboDate(at).slice(0, 4));
}

/** Adds n calendar days to a YYYY-MM-DD date. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
