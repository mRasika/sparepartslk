import { describe, expect, it } from "vitest";
import { addDays, colomboDate, colomboYear } from "@/lib/dates";
import { D, fmt, round2, sum } from "@/lib/money";

describe("money", () => {
  it("rounds half-up to 2 decimals", () => {
    expect(round2(D("89.985")).toFixed(2)).toBe("89.99");
    expect(round2(D("-0.005")).toFixed(2)).toBe("-0.01");
  });

  it("formats for the DB with exactly 2 decimals", () => {
    expect(fmt(D("5"))).toBe("5.00");
    expect(fmt(D("1.005"))).toBe("1.01");
  });

  it("sums exactly without float drift", () => {
    expect(fmt(sum([D("0.1"), D("0.2")]))).toBe("0.30");
    expect(fmt(sum([]))).toBe("0.00");
  });
});

describe("dates", () => {
  it("takes the year from Colombo local time", () => {
    expect(colomboYear(new Date("2026-12-31T19:00:00Z"))).toBe(2027);
    expect(colomboYear(new Date("2026-12-31T18:00:00Z"))).toBe(2026);
  });

  it("formats the Colombo business date", () => {
    expect(colomboDate(new Date("2026-10-21T20:00:00Z"))).toBe("2026-10-22");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-15", 30)).toBe("2027-01-14");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
