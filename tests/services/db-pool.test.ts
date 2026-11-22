import { describe, expect, it } from "vitest";
import { poolMax } from "@/server/db/client";

describe("poolMax (DB_POOL_MAX)", () => {
  it("defaults to 4 when unset or empty", () => {
    expect(poolMax(undefined)).toBe(4);
    expect(poolMax("")).toBe(4);
  });

  it("uses a whole number from 1 to 50", () => {
    expect(poolMax("10")).toBe(10);
    expect(poolMax("1")).toBe(1);
    expect(poolMax("50")).toBe(50);
  });

  it("falls back to 4 for anything else", () => {
    expect(poolMax("0")).toBe(4);
    expect(poolMax("51")).toBe(4);
    expect(poolMax("abc")).toBe(4);
    expect(poolMax("2.5")).toBe(4);
  });
});
