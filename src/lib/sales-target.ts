import { addDays } from "@/lib/dates";
import { D, fmt, sum } from "@/lib/money";
import { isDate } from "@/lib/periods";

/** One saved daily target; it applies from `effectiveFrom` until the next row. */
export type TargetRow = { effectiveFrom: string; dailyTarget: string; closedWeekdays: number[] };
export type DayStatus = "hit" | "missed" | "in-progress" | "upcoming" | "closed" | "no-target";
export type PlanDay = { date: string; target: string | null; sales: string; status: DayStatus };

export type MonthPlan = {
  /** Every day of the report date's calendar month. */
  days: PlanDay[];
  /** Targets of all the month's trading days. */
  monthTarget: string;
  /** Targets of trading days up to the report date: where sales should be by then. */
  paceTarget: string;
  /** Net sales from the 1st to the report date. */
  mtd: string;
  daysHit: number;
  /** Trading days up to the report date; the report date only once it is hit or missed. */
  daysCounted: number;
  tradingDaysLeft: number;
  needPerDay: string | null;
  outcome: "open" | "reached" | "missed";
  hasTarget: boolean;
};

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

export function targetOn(date: string, rows: TargetRow[]): TargetRow | null {
  let found: TargetRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom <= date && (!found || row.effectiveFrom > found.effectiveFrom)) found = row;
  }
  return found;
}

export function isTradingDay(date: string, rows: TargetRow[], closedDays: ReadonlySet<string>): boolean {
  const row = targetOn(date, rows);
  return row !== null && !row.closedWeekdays.includes(isoWeekday(date)) && !closedDays.has(date);
}

/** Each day's target and status for the report date's month, and how the month stands (spec §2). */
export function monthPlan(input: {
  reportDate: string;
  today: string;
  rows: TargetRow[];
  closedDays: string[];
  dailySales: Record<string, string>;
}): MonthPlan {
  const { reportDate, today, rows, dailySales } = input;
  const closed = new Set(input.closedDays);
  const first = `${reportDate.slice(0, 8)}01`;

  const days: PlanDay[] = [];
  for (let date = first; date.slice(0, 7) === first.slice(0, 7); date = addDays(date, 1)) {
    const sales = dailySales[date] ?? "0.00";
    if (!isTradingDay(date, rows, closed)) {
      days.push({ date, target: null, sales, status: targetOn(date, rows) ? "closed" : "no-target" });
      continue;
    }
    const target = targetOn(date, rows)!.dailyTarget;
    const status: DayStatus =
      date > reportDate
        ? "upcoming"
        : D(sales).gte(target)
          ? "hit"
          : date === reportDate && date === today
            ? "in-progress"
            : "missed";
    days.push({ date, target, sales, status });
  }

  const trading = days.filter((d) => d.target !== null);
  const soFar = trading.filter((d) => d.date <= reportDate);
  const monthTarget = sum(trading.map((d) => D(d.target!)));
  const mtd = sum(days.filter((d) => d.date <= reportDate).map((d) => D(d.sales)));
  const tradingDaysLeft = trading.length - soFar.length;
  const hasTarget = trading.length > 0;
  const reportStatus = days.find((d) => d.date === reportDate)?.status;

  const outcome: MonthPlan["outcome"] =
    hasTarget && mtd.gte(monthTarget)
      ? "reached"
      : hasTarget && tradingDaysLeft === 0 && reportStatus !== "in-progress"
        ? "missed"
        : "open";

  return {
    days,
    monthTarget: fmt(monthTarget),
    paceTarget: fmt(sum(soFar.map((d) => D(d.target!)))),
    mtd: fmt(mtd),
    daysHit: soFar.filter((d) => d.status === "hit").length,
    daysCounted: soFar.filter((d) => d.status === "hit" || d.status === "missed").length,
    tradingDaysLeft,
    needPerDay:
      hasTarget && outcome === "open" && tradingDaysLeft > 0
        ? fmt(monthTarget.minus(mtd).div(tradingDaysLeft))
        : null,
    outcome,
    hasTarget,
  };
}

/** Whole percent of `of`, never below 0; 0 when there is nothing to measure against. */
export function percentOf(value: string, of: string): number {
  if (D(of).lte(0)) return 0;
  return Math.max(0, Math.round(D(value).div(of).times(100).toNumber()));
}

/** The report's date: today when missing; null when it isn't a real date up to today. */
export function parseReportDate(value: string | null | undefined, today: string): string | null {
  if (!value) return today;
  return isDate(value) && value <= today ? value : null;
}
