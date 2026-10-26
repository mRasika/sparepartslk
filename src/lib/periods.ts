import { addDays, colomboDate } from "@/lib/dates";

export type PeriodPreset = "week" | "month" | "last-month" | "3-months" | "year";
export type Bucket = "day" | "week" | "month";
/** Inclusive business dates, YYYY-MM-DD. */
export type DateRange = { from: string; to: string };
export type Period = { preset: PeriodPreset | "custom"; range: DateRange; compare: DateRange; bucket: Bucket };

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "3-months", label: "Last 3 months" },
  { value: "year", label: "This year" },
];

/** Longest custom range: 3 years, counting both ends. */
const MAX_CUSTOM_DAYS = 1096;

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function isDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = utc(value);
  return !Number.isNaN(d.getTime()) && iso(d) === value;
}

/** Days from `from` to `to`, counting both ends. */
function dayCount(r: DateRange): number {
  return Math.round((utc(r.to).getTime() - utc(r.from).getTime()) / 86_400_000) + 1;
}

function monthStart(date: string, monthsBack = 0): string {
  const d = utc(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1)));
}

function monthEnd(date: string): string {
  const d = utc(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** Moves a date by whole months, clamped to the target month's last day (Mar 31 − 1 → Feb 28). */
function addMonths(date: string, n: number): string {
  const day = Number(date.slice(8, 10));
  const start = monthStart(date, -n);
  const end = monthEnd(start);
  return Number(end.slice(8, 10)) < day ? end : `${start.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/** The same number of days just before the range. */
function previousRange(r: DateRange): DateRange {
  return { from: addDays(r.from, -dayCount(r)), to: addDays(r.from, -1) };
}

function presetPeriod(preset: PeriodPreset, today: string): Period {
  switch (preset) {
    case "week": {
      const weekday = (utc(today).getUTCDay() + 6) % 7; // Monday = 0
      const range = { from: addDays(today, -weekday), to: today };
      return { preset, range, compare: { from: addDays(range.from, -7), to: addDays(today, -7) }, bucket: "day" };
    }
    case "month": {
      const from = monthStart(today);
      const prevFrom = monthStart(today, 1);
      const sameDay = addMonths(today, -1);
      return { preset, range: { from, to: today }, compare: { from: prevFrom, to: sameDay }, bucket: "day" };
    }
    case "last-month": {
      const from = monthStart(today, 1);
      const before = monthStart(today, 2);
      return {
        preset,
        range: { from, to: monthEnd(from) },
        compare: { from: before, to: monthEnd(before) },
        bucket: "day",
      };
    }
    case "3-months": {
      const range = { from: addDays(addMonths(today, -3), 1), to: today };
      return { preset, range, compare: previousRange(range), bucket: "week" };
    }
    case "year": {
      const from = `${today.slice(0, 4)}-01-01`;
      const lastYear = addMonths(today, -12);
      return { preset, range: { from, to: today }, compare: { from: `${lastYear.slice(0, 4)}-01-01`, to: lastYear }, bucket: "month" };
    }
  }
}

function customBucket(days: number): Bucket {
  if (days <= 31) return "day";
  if (days <= 92) return "week";
  return "month";
}

/**
 * Turns the dashboard's URL params into a date range, its comparison range and the chart grouping
 * (spec §4). A valid from/to wins over `period`; anything invalid falls back to this month.
 */
export function resolvePeriod(
  params: { period?: string; from?: string; to?: string },
  today: string = colomboDate(),
): Period {
  const { period, from, to } = params;
  if (isDate(from) && isDate(to) && from <= to && to <= today) {
    const range = { from, to };
    const days = dayCount(range);
    if (days <= MAX_CUSTOM_DAYS) {
      return { preset: "custom", range, compare: previousRange(range), bucket: customBucket(days) };
    }
  }
  const preset = PERIOD_PRESETS.find((p) => p.value === period)?.value ?? "month";
  return presetPeriod(preset, today);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 1–25", "Aug 1 – Sep 15", "Jan 1 – Oct 25, 2025"; the year shows when it isn't today's. */
export function formatRange(r: DateRange, today: string = colomboDate()): string {
  const [fy, fm, fd] = r.from.split("-").map(Number);
  const [ty, tm, td] = r.to.split("-").map(Number);
  const thisYear = Number(today.slice(0, 4));
  const day = (m: number, d: number) => `${MONTHS[m - 1]} ${d}`;
  if (r.from === r.to) return fy === thisYear ? day(fm, fd) : `${day(fm, fd)}, ${fy}`;
  if (fy !== ty) return `${day(fm, fd)}, ${fy} – ${day(tm, td)}, ${ty}`;
  const suffix = fy === thisYear ? "" : `, ${fy}`;
  if (fm === tm) return `${day(fm, fd)}–${td}${suffix}`;
  return `${day(fm, fd)} – ${day(tm, td)}${suffix}`;
}

/** The earliest From the Custom picker allows with a To of today (the 3-year limit). */
export function earliestCustomFrom(today: string = colomboDate()): string {
  return addDays(today, -(MAX_CUSTOM_DAYS - 1));
}

/** Chart axis label for a bucket: "Oct" / "Oct 19", with the year when the chart spans years. */
export function bucketLabel(date: string, bucket: Bucket, withYear: boolean): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  if (bucket === "month") return withYear ? `${month} ’${date.slice(2, 4)}` : month;
  const day = `${month} ${Number(date.slice(8, 10))}`;
  return withYear ? `${day}, ${date.slice(0, 4)}` : day;
}
