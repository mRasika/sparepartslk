import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { Forbidden, InvalidState } from "@/server/errors";
import { createCustomer, updateCustomer, type CustomerInput } from "@/server/services/customers";
import { resetDb } from "../helpers/db";
import { makeCustomer, makeUser, tierIds } from "../helpers/factories";

let admin: SessionUser;
let staff: SessionUser;

async function input(overrides: Partial<CustomerInput> = {}): Promise<CustomerInput> {
  const tiers = await tierIds();
  return {
    name: "Saman Motors",
    phone: "077 123 4567",
    tierId: tiers.Retail,
    creditLimit: "0.00",
    creditDays: 30,
    isActive: true,
    ...overrides,
  };
}

async function load(id: string) {
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  return row;
}

describe("customers", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    staff = await makeUser("staff");
  });

  it("lets staff create cash customers", async () => {
    const { id } = await createCustomer(staff, await input());
    expect((await load(id)).name).toBe("Saman Motors");
  });

  it("forbids staff from giving credit", async () => {
    await expect(createCustomer(staff, await input({ creditLimit: "5000.00" }))).rejects.toBeInstanceOf(Forbidden);
  });

  it("forbids staff from creating customers on a special tier", async () => {
    const tiers = await tierIds();
    await expect(createCustomer(staff, await input({ tierId: tiers.Dealer }))).rejects.toBeInstanceOf(Forbidden);
  });

  it("lets an admin set tier and credit", async () => {
    const tiers = await tierIds();
    const { id } = await createCustomer(admin, await input({ tierId: tiers.Dealer, creditLimit: "50000" }));
    const row = await load(id);
    expect(row.tierId).toBe(tiers.Dealer);
    expect(row.creditLimit).toBe("50000.00");
  });

  it("forbids staff from changing a customer's tier", async () => {
    const tiers = await tierIds();
    const c = await makeCustomer();
    await expect(
      updateCustomer(staff, c.id, await input({ name: c.name, tierId: tiers.Dealer })),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("lets staff update contact details", async () => {
    const c = await makeCustomer({ tier: "Dealer", creditLimit: "1000.00", creditDays: 45 });
    const current = await load(c.id);
    await updateCustomer(staff, c.id, {
      name: current.name,
      phone: "071 999 0000",
      tierId: current.tierId,
      creditLimit: current.creditLimit,
      creditDays: current.creditDays,
      isActive: true,
    });
    expect((await load(c.id)).phone).toBe("071 999 0000");
  });

  it("keeps the walk-in customer cash-only and active", async () => {
    const [walkIn] = await db.select().from(customers).where(eq(customers.isWalkIn, true));
    const base = {
      name: walkIn.name,
      tierId: walkIn.tierId,
      creditLimit: "0.00",
      creditDays: 0,
      isActive: true,
    };
    await expect(updateCustomer(admin, walkIn.id, { ...base, creditLimit: "100" })).rejects.toBeInstanceOf(
      InvalidState,
    );
    await expect(updateCustomer(admin, walkIn.id, { ...base, isActive: false })).rejects.toBeInstanceOf(
      InvalidState,
    );
  });
});
