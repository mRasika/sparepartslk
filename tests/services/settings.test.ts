import { beforeEach, describe, expect, it } from "vitest";
import { getSettings } from "@/server/services/settings";
import { resetDb } from "../helpers/db";

describe("settings", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns the seeded defaults", async () => {
    const s = await getSettings();
    expect(s).toMatchObject({
      vatEnabled: false,
      vatRate: "18.00",
      staffMaxDiscountPct: "10.00",
      defaultCreditDays: 30,
      docPrefix: "",
    });
  });
});
