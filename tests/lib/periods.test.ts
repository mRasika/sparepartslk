import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { formatRange, resolvePeriod } from "@/lib/periods";

const T = "2026-10-25"; // a Sunday

describe("resolvePeriod", () => {
  it("defaults to this month", () => {
    expect(resolvePeriod({}, T)).toEqual({
      preset: "month",
      range: { from: "2026-10-01", to: T },
      compare: { from: "2026-09-01", to: "2026-09-25" },
      bucket: "day",
    });
  });

  it("starts this week on Monday", () => {
    expect(resolvePeriod({ period: "week" }, T)).toMatchObject({
      range: { from: "2026-10-19", to: T },
      compare: { from: "2026-10-12", to: "2026-10-18" },
      bucket: "day",
    });
  });

  it("makes this week one day long on a Monday", () => {
    expect(resolvePeriod({ period: "week" }, "2026-10-19").range).toEqual({ from: "2026-10-19", to: "2026-10-19" });
  });

  it("takes all of last month and compares with the month before", () => {
    expect(resolvePeriod({ period: "last-month" }, T)).toMatchObject({
      range: { from: "2026-09-01", to: "2026-09-30" },
      compare: { from: "2026-08-01", to: "2026-08-31" },
      bucket: "day",
    });
  });

  it("rolls the last 3 months and groups them by week", () => {
    expect(resolvePeriod({ period: "3-months" }, T)).toMatchObject({
      range: { from: "2026-07-26", to: T },
      compare: { from: "2026-04-25", to: "2026-07-25" },
      bucket: "week",
    });
  });

  it("compares this year with the same dates last year", () => {
    expect(resolvePeriod({ period: "year" }, T)).toMatchObject({
      range: { from: "2026-01-01", to: T },
      compare: { from: "2025-01-01", to: "2025-10-25" },
      bucket: "month",
    });
  });

  it("clamps this month's comparison to the previous month's end", () => {
    expect(resolvePeriod({ period: "month" }, "2027-03-31").compare).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });

  it("maps Feb 29 to Feb 28 last year", () => {
    expect(resolvePeriod({ period: "year" }, "2028-02-29").compare).toEqual({ from: "2027-01-01", to: "2027-02-28" });
  });

  it("compares a custom range with the same number of days before it", () => {
    expect(resolvePeriod({ from: "2026-08-01", to: "2026-09-15" }, T)).toEqual({
      preset: "custom",
      range: { from: "2026-08-01", to: "2026-09-15" },
      compare: { from: "2026-06-16", to: "2026-07-31" },
      bucket: "week",
    });
  });

  it.each([
    [31, "day"],
    [32, "week"],
    [92, "week"],
    [93, "month"],
  ])("groups a custom range of %i days by %s", (days, bucket) => {
    expect(resolvePeriod({ from: addDays(T, -(days - 1)), to: T }, T).bucket).toBe(bucket);
  });

  it("prefers a custom range over a preset", () => {
    expect(resolvePeriod({ period: "year", from: "2026-10-01", to: "2026-10-02" }, T).preset).toBe("custom");
  });

  it.each([
    [{ period: "foo" }],
    [{ from: "2026-02-30", to: "2026-03-01" }],
    [{ from: "2026-10-01" }],
    [{ from: "2026-10-10", to: "2026-10-01" }],
    [{ from: "2026-10-01", to: "2026-10-26" }],
    [{ from: "2022-01-01", to: "2026-10-01" }],
    [{ from: "not-a-date", to: T }],
  ])("falls back to this month for %j", (params) => {
    expect(resolvePeriod(params, T).preset).toBe("month");
  });

  it("accepts a range of 3 years", () => {
    expect(resolvePeriod({ from: "2023-10-27", to: T }, T).preset).toBe("custom");
  });
});

describe("formatRange", () => {
  it.each([
    [{ from: "2026-09-01", to: "2026-09-25" }, "Sep 1–25"],
    [{ from: "2026-08-01", to: "2026-09-15" }, "Aug 1 – Sep 15"],
    [{ from: "2025-01-01", to: "2025-10-25" }, "Jan 1 – Oct 25, 2025"],
    [{ from: "2025-12-29", to: "2026-01-04" }, "Dec 29, 2025 – Jan 4, 2026"],
    [{ from: "2026-10-19", to: "2026-10-19" }, "Oct 19"],
  ])("formats %j as %s", (range, text) => {
    expect(formatRange(range, T)).toBe(text);
  });
});
