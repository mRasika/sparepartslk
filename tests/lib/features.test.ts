import { afterEach, describe, expect, it, vi } from "vitest";
import { requireSalesTarget, salesTargetEnabled } from "@/server/features";

describe("sales target feature switch", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless FEATURE_SALES_TARGET is 1", () => {
    vi.stubEnv("FEATURE_SALES_TARGET", "");
    expect(salesTargetEnabled()).toBe(false);
    vi.stubEnv("FEATURE_SALES_TARGET", "true");
    expect(salesTargetEnabled()).toBe(false);
    vi.stubEnv("FEATURE_SALES_TARGET", "1");
    expect(salesTargetEnabled()).toBe(true);
  });

  it("refuses target writes while off", () => {
    vi.stubEnv("FEATURE_SALES_TARGET", "");
    expect(() => requireSalesTarget()).toThrow("The sales target isn't turned on");
    vi.stubEnv("FEATURE_SALES_TARGET", "1");
    expect(() => requireSalesTarget()).not.toThrow();
  });
});
