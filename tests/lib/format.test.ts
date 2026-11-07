import { describe, expect, it } from "vitest";
import { formatMoney, formatSince } from "@/lib/format";

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
