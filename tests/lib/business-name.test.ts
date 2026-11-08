import { describe, expect, it } from "vitest";
import { displayName } from "@/lib/business-name";

describe("displayName", () => {
  it("uses the saved business name, trimmed", () => {
    expect(displayName("  Silva Motors ")).toBe("Silva Motors");
  });

  it("falls back to Sparepartslk when nothing is saved", () => {
    for (const empty of ["", "   ", null, undefined]) expect(displayName(empty)).toBe("Sparepartslk");
  });
});
