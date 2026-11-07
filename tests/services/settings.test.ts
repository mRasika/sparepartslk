import { beforeEach, describe, expect, it } from "vitest";
import { Forbidden } from "@/server/errors";
import { createInvoice } from "@/server/services/invoicing";
import { getInvoicePrintData } from "@/server/services/print";
import { findSettings, getSettings, updateSettings, type SettingsInput } from "@/server/services/settings";
import { db } from "@/server/db/client";
import { logo, settings } from "@/server/db/schema";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

const base: SettingsInput = {
  businessName: "Sparepartslk",
  address: "45 Kandy Road, Kadawatha",
  phone: "011 222 3344",
  email: "sales@example.lk",
  tin: "409876543",
  vatEnabled: false,
  vatRate: "18.00",
  staffMaxDiscountPct: "10.00",
  defaultCreditDays: 30,
  docPrefix: "",
};

describe("settings", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("findSettings gives the row, or null when there is none", async () => {
    await expect(findSettings()).resolves.toMatchObject({ id: 1 });
    await db.delete(settings);
    await expect(findSettings()).resolves.toBeNull();
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

  it("saving with no logo deletes the stored logo", async () => {
    const admin = await makeUser("admin");
    await db.insert(logo).values({ contentType: "image/png", data: Buffer.from([0x89, 0x50]) });
    await updateSettings(admin, { ...base, logoUrl: null });
    expect(await db.select().from(logo)).toHaveLength(0);
  });

  it("keeps the stored logo when the logo address is left as it is", async () => {
    const admin = await makeUser("admin");
    await db.insert(logo).values({ contentType: "image/png", data: Buffer.from([0x89, 0x50]) });
    await updateSettings(admin, { ...base, logoUrl: "/api/logo?v=17" });
    expect(await db.select().from(logo)).toHaveLength(1);
  });

  it("accepts only an /api/logo address or an https link as the logo", async () => {
    const admin = await makeUser("admin");
    for (const ok of ["/api/logo?v=17", "https://x.supabase.co/storage/v1/object/public/branding/a.png"]) {
      await updateSettings(admin, { ...base, logoUrl: ok });
      expect((await getSettings()).logoUrl).toBe(ok);
    }
    for (const bad of ["http://x/a.png", "javascript:alert(1)", "/api/logo?v=abc", "/elsewhere.png"]) {
      await expect(updateSettings(admin, { ...base, logoUrl: bad })).rejects.toThrow();
    }
  });

  it("is admin only", async () => {
    const staff = await makeUser("staff");
    await expect(updateSettings(staff, base)).rejects.toBeInstanceOf(Forbidden);
  });

  it("rejects a VAT rate over 100", async () => {
    const admin = await makeUser("admin");
    const err = await updateSettings(admin, { ...base, vatRate: "120" }).catch((e) => e);
    expect(err.name).toBe("ZodError");
  });

  it("rejects a lowercase or long document prefix", async () => {
    const admin = await makeUser("admin");
    await expect(updateSettings(admin, { ...base, docPrefix: "sp" })).rejects.toThrow();
    await expect(updateSettings(admin, { ...base, docPrefix: "TOOLONG" })).rejects.toThrow();
  });

  it("titles new invoices TAX INVOICE once VAT is enabled", async () => {
    const admin = await makeUser("admin");
    await updateSettings(admin, { ...base, vatEnabled: true, vatRate: "18" });
    expect((await getSettings()).vatRate).toBe("18.00");
    const customer = await makeCustomer();
    const part = await makePart({ qty: 3 });
    const inv = await createInvoice(admin, { customerId: customer.id, paymentType: "cash", lines: [{ partId: part.id, qty: 1 }] });
    expect((await getInvoicePrintData(admin, inv.id)).title).toBe("TAX INVOICE");
  });
});
