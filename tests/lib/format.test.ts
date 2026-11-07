import { describe, expect, it } from "vitest";
import { formatDayMonth, formatDays, formatMoney, formatRsShort, formatSince, moneyColumn } from "@/lib/format";

describe("formatMoney", () => {
  it("groups thousands and keeps 2 decimals", () => {
    expect(formatMoney("5400.00")).toBe("5,400.00");
    expect(formatMoney("1234567.5")).toBe("1,234,567.50");
    expect(formatMoney("0.75")).toBe("0.75");
    expect(formatMoney("-500.00")).toBe("-500.00");
    expect(formatMoney("100")).toBe("100.00");
  });
});

describe("formatSince", () => {
  const today = "2026-11-07";
  it("says recent dates in words, up to 30 days", () => {
    expect(formatSince("2026-11-07", today)).toBe("Today");
    expect(formatSince("2026-11-06", today)).toBe("Yesterday");
    expect(formatSince("2026-11-01", today)).toBe("6 days ago");
    expect(formatSince("2026-10-25", today)).toBe("13 days ago");
    expect(formatSince("2026-10-24", today)).toBe("2 weeks ago");
    expect(formatSince("2026-10-08", today)).toBe("4 weeks ago");
  });
  it("shows older dates as a short date, with the year only when it differs", () => {
    expect(formatSince("2026-10-07", today)).toBe("7 Oct");
    expect(formatSince("2025-12-20", today)).toBe("20 Dec 2025");
    expect(formatSince("2026-11-09", today)).toBe("9 Nov"); // a future date isn't "ago"
  });
});

describe("formatRsShort", () => {
  it("keeps amounts under Rs 100,000 in full, without cents", () => {
    expect(formatRsShort("67600.00")).toBe("Rs 67,600");
    expect(formatRsShort("99999.40")).toBe("Rs 99,999");
    expect(formatRsShort("0.00")).toBe("Rs 0");
    expect(formatRsShort("1500.75")).toBe("Rs 1,501");
  });
  it("rounds to thousands and millions above that", () => {
    expect(formatRsShort("512300.00")).toBe("Rs 512k");
    expect(formatRsShort("257500.00")).toBe("Rs 258k");
    expect(formatRsShort("999600.00")).toBe("Rs 1M");
    expect(formatRsShort("3410000.00")).toBe("Rs 3.4M");
    expect(formatRsShort("6500000.00")).toBe("Rs 6.5M");
    expect(formatRsShort("12049000.00")).toBe("Rs 12M");
    expect(formatRsShort("2500000000.00")).toBe("Rs 2.5B");
  });
  it("keeps the sign", () => {
    expect(formatRsShort("-5000.00")).toBe("-Rs 5,000");
    expect(formatRsShort("-250000.00")).toBe("-Rs 250k");
  });
});

describe("moneyColumn", () => {
  it("drops .00 when every amount in the column is whole", () => {
    const f = moneyColumn(["245800.00", "1500.00", null]);
    expect(f("245800.00")).toBe("245,800");
    expect(f("1500.00")).toBe("1,500");
  });
  it("keeps cents on every row when any row has them, so decimals line up", () => {
    const f = moneyColumn(["245800.00", "1234.50"]);
    expect(f("245800.00")).toBe("245,800.00");
    expect(f("1234.50")).toBe("1,234.50");
  });
});

describe("formatDays", () => {
  it("says long spans in months and years", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(38)).toBe("38 days");
    expect(formatDays(59)).toBe("59 days");
    expect(formatDays(60)).toBe("about 2 months");
    expect(formatDays(152)).toBe("about 5 months");
    expect(formatDays(365)).toBe("about 1 year");
    expect(formatDays(548)).toBe("about 1.5 years");
  });
});

describe("formatDayMonth", () => {
  it("leaves the year out when it is this year", () => {
    expect(formatDayMonth("2026-08-02", "2026-11-07")).toBe("2 Aug");
    expect(formatDayMonth("2025-12-20", "2026-11-07")).toBe("20 Dec 2025");
  });
});
