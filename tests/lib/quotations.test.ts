import { describe, expect, it } from "vitest";
import { quotationStatus } from "@/lib/quotations";

describe("quotationStatus", () => {
  it("is open until the day after valid until", () => {
    expect(quotationStatus("open", "2026-10-26", "2026-10-26")).toBe("open");
    expect(quotationStatus("open", "2026-10-25", "2026-10-26")).toBe("expired");
  });

  it("keeps converted and cancelled whatever the date", () => {
    expect(quotationStatus("converted", "2026-01-01", "2026-10-26")).toBe("converted");
    expect(quotationStatus("cancelled", "2026-01-01", "2026-10-26")).toBe("cancelled");
  });
});
