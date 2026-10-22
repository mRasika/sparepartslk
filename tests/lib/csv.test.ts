import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("quotes fields with commas, quotes or newlines and uses CRLF", () => {
    const csv = toCsv(["SKU", "Name", "Qty"], [
      ["A-1", 'Bolt, 10mm "hex"', 3],
      ["B-2", "Plain", null],
    ]);
    expect(csv).toBe('SKU,Name,Qty\r\nA-1,"Bolt, 10mm ""hex""",3\r\nB-2,Plain,\r\n');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(toCsv(["Name"], [["=HYPERLINK(1)"]])).toBe("Name\r\n'=HYPERLINK(1)\r\n");
  });
});
