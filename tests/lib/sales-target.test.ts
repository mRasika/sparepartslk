import { describe, expect, it } from "vitest";
import {
  isoWeekday,
  isTradingDay,
  monthPlan,
  parseReportDate,
  percentOf,
  targetOn,
  type TargetRow,
} from "@/lib/sales-target";

// October 2026 starts on a Thursday; its Sundays are the 4th, 11th, 18th and 25th.
const R: TargetRow = { effectiveFrom: "2026-10-01", dailyTarget: "250000.00", closedWeekdays: [7] };
const T = "2026-10-26"; // a Monday

function plan(overrides: Partial<Parameters<typeof monthPlan>[0]> = {}) {
  return monthPlan({ reportDate: T, today: T, rows: [R], closedDays: [], dailySales: {}, ...overrides });
}

const status = (p: ReturnType<typeof monthPlan>, date: string) => p.days.find((d) => d.date === date)?.status;

describe("isoWeekday", () => {
  it("numbers Monday 1 to Sunday 7", () => {
    expect(isoWeekday("2026-10-26")).toBe(1);
    expect(isoWeekday("2026-10-25")).toBe(7);
  });
});

describe("targetOn", () => {
  it("uses the latest row on or before the date", () => {
    const rows: TargetRow[] = [R, { effectiveFrom: "2026-10-15", dailyTarget: "300000.00", closedWeekdays: [] }];
    expect(targetOn("2026-10-14", rows)?.dailyTarget).toBe("250000.00");
    expect(targetOn("2026-10-15", rows)?.dailyTarget).toBe("300000.00");
    expect(targetOn("2026-09-30", rows)).toBeNull();
  });
});

describe("isTradingDay", () => {
  it("skips closed weekdays and closed dates", () => {
    const closed = new Set(["2026-10-02"]);
    expect(isTradingDay("2026-10-25", [R], closed)).toBe(false);
    expect(isTradingDay("2026-10-02", [R], closed)).toBe(false);
    expect(isTradingDay("2026-10-26", [R], closed)).toBe(true);
  });
});

describe("monthPlan", () => {
  it("sums the targets of the month's trading days", () => {
    const p = plan();
    expect(p.monthTarget).toBe("6750000.00");
    expect(p.days).toHaveLength(31);
    expect(p.hasTarget).toBe(true);
  });

  it("mixes targets across a mid-month change", () => {
    const p = plan({
      rows: [
        { effectiveFrom: "2026-10-01", dailyTarget: "250000.00", closedWeekdays: [] },
        { effectiveFrom: "2026-10-15", dailyTarget: "300000.00", closedWeekdays: [] },
      ],
    });
    expect(p.monthTarget).toBe("8600000.00");
    expect(p.days.find((d) => d.date === "2026-10-14")?.target).toBe("250000.00");
  });

  it("marks hit, missed, in-progress, upcoming and closed", () => {
    const p = plan({ dailySales: { "2026-10-01": "260000.00", "2026-10-02": "100000.00", "2026-10-26": "50000.00" } });
    expect(status(p, "2026-10-01")).toBe("hit");
    expect(status(p, "2026-10-02")).toBe("missed");
    expect(status(p, "2026-10-04")).toBe("closed");
    expect(status(p, "2026-10-26")).toBe("in-progress");
    expect(status(p, "2026-10-27")).toBe("upcoming");
    expect(p.days.find((d) => d.date === "2026-10-04")?.target).toBeNull();
  });

  it("counts today once it is hit", () => {
    // 1–25 Oct hold 21 trading days, all missed with no sales.
    const hit = plan({ dailySales: { "2026-10-26": "250000.00" } });
    expect(status(hit, T)).toBe("hit");
    expect(hit.daysHit).toBe(1);
    expect(hit.daysCounted).toBe(22);

    const notYet = plan({ dailySales: { "2026-10-26": "50000.00" } });
    expect(notYet.daysHit).toBe(0);
    expect(notYet.daysCounted).toBe(21);
  });

  it("works out what each remaining day needs", () => {
    const p = plan({ dailySales: { "2026-10-01": "1000000.00", "2026-10-26": "2000000.00" } });
    expect(p.mtd).toBe("3000000.00");
    expect(p.tradingDaysLeft).toBe(5);
    expect(p.needPerDay).toBe("750000.00");
    expect(p.outcome).toBe("open");
  });

  it("sets the pace to the targets of trading days so far", () => {
    expect(plan().paceTarget).toBe("5500000.00"); // 22 trading days to 26 Oct
  });

  it("reports the month reached", () => {
    const p = plan({ dailySales: { "2026-10-01": "6750000.00" } });
    expect(p.outcome).toBe("reached");
    expect(p.needPerDay).toBeNull();
  });

  it("does not miss the month while the last day is in progress", () => {
    const open = plan({ reportDate: "2026-10-31", today: "2026-10-31" });
    expect(status(open, "2026-10-31")).toBe("in-progress");
    expect(open.tradingDaysLeft).toBe(0);
    expect(open.outcome).toBe("open");
    expect(open.needPerDay).toBeNull();

    const missed = plan({ reportDate: "2026-10-31", today: "2026-11-01" });
    expect(status(missed, "2026-10-31")).toBe("missed");
    expect(missed.outcome).toBe("missed");
  });

  it("counts only days from the first target", () => {
    const p = plan({ rows: [{ ...R, effectiveFrom: "2026-10-20" }] });
    expect(status(p, "2026-10-19")).toBe("no-target");
    expect(p.monthTarget).toBe("2750000.00");
    expect(p.daysCounted).toBe(5); // 20–24 Oct; the 25th is a Sunday and the 26th is in progress
  });

  it("has no target when no row is in force", () => {
    const p = plan({ rows: [] });
    expect(p.hasTarget).toBe(false);
    expect(p.monthTarget).toBe("0.00");
    expect(p.days.every((d) => d.status === "no-target")).toBe(true);
    expect(p.needPerDay).toBeNull();
  });

  it("ends the month on the report date when every later day is closed", () => {
    const closedDays = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"];
    const inProgress = plan({ closedDays, dailySales: { [T]: "100000.00" } });
    expect(inProgress.tradingDaysLeft).toBe(0);
    expect(inProgress.outcome).toBe("open");
    expect(inProgress.needPerDay).toBeNull();

    const hitButShort = plan({ closedDays, dailySales: { [T]: "300000.00" } });
    expect(status(hitButShort, T)).toBe("hit");
    expect(hitButShort.outcome).toBe("missed");
  });

  it("handles negative sales on a day of returns", () => {
    const p = plan({ dailySales: { [T]: "-5000.00" } });
    expect(status(p, T)).toBe("in-progress");
    expect(p.mtd).toBe("-5000.00");
    expect(p.needPerDay).toBe("1351000.00");
    expect(percentOf(p.mtd, p.monthTarget)).toBe(0);
  });

  it("skips closed dates in the month target", () => {
    expect(plan({ closedDays: ["2026-10-30"] }).monthTarget).toBe("6500000.00");
  });

  it("covers the whole calendar month", () => {
    const feb = (y: number) => plan({ reportDate: `${y}-02-10`, today: `${y}-02-10` }).days.length;
    expect(feb(2027)).toBe(28);
    expect(feb(2028)).toBe(29);
  });
});

describe("percentOf", () => {
  it("clamps negative sales to 0", () => {
    expect(percentOf("-500.00", "250000.00")).toBe(0);
    expect(percentOf("125000.00", "250000.00")).toBe(50);
    expect(percentOf("1.00", "0.00")).toBe(0);
  });
});

describe("parseReportDate", () => {
  it("takes a real date up to today", () => {
    expect(parseReportDate(null, T)).toBe(T);
    expect(parseReportDate("", T)).toBe(T);
    expect(parseReportDate("2026-02-30", T)).toBeNull();
    expect(parseReportDate("2026-10-27", T)).toBeNull();
    expect(parseReportDate("2026-10-01", T)).toBe("2026-10-01");
  });
});
