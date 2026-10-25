import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, colomboDate } from "@/lib/dates";
import { D, fmt, sum } from "@/lib/money";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { invoiceItems } from "@/server/db/schema";
import { Forbidden } from "@/server/errors";
import { stockList } from "@/server/services/inventory";
import { cancelInvoice, createInvoice } from "@/server/services/invoicing";
import { createReturn } from "@/server/services/returns";
import { getSalesTotals, salesByPart } from "@/server/services/sales-analytics";
import { getStockHealth } from "@/server/services/stock-health";
import { resetDb } from "../helpers/db";
import { makeCustomer, makePart, makeUser } from "../helpers/factories";

let admin: SessionUser;
let customerId: string;
const today = colomboDate();

function sell(partId: string, qty: number, invoiceDate = today) {
  return createInvoice(admin, { customerId, paymentType: "credit", invoiceDate, lines: [{ partId, qty }] });
}

describe("getStockHealth", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("admin");
    customerId = (await makeCustomer({ creditLimit: "1000000.00" })).id;
  });

  it("takes the last sale from issued invoices only", async () => {
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    await sell(part.id, 1, addDays(today, -30));
    await cancelInvoice(admin, (await sell(part.id, 1)).id, "test");

    const h = await getStockHealth(admin);
    expect(h.byPart[part.id].lastSoldOn).toBe(addDays(today, -30));
  });

  it("ages a never-sold part from its arrival", async () => {
    const part = await makePart({ qty: 3, avgCost: "600.00" });
    await db.execute(sql`update stock_movements set created_at = now() - interval '200 days' where part_id = ${part.id}`);

    expect((await getStockHealth(admin)).byPart[part.id].band).toBe("181-365");
  });

  it("takes returns off a part's sales", async () => {
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    const inv = await sell(part.id, 3);
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
    await createReturn(admin, { invoiceId: inv.id, reason: "Wrong part", lines: [{ invoiceItemId: item.id, qty: 2, restock: true }] });

    expect(await salesByPart({ from: today, to: today })).toEqual([{ partId: part.id, sales: "1000.00" }]);
  });

  it("counts days of stock from the Sales & profit cost", async () => {
    const part = await makePart({ qty: 10, avgCost: "600.00" });
    await sell(part.id, 1);

    const h = await getStockHealth(admin);
    const { cost } = await getSalesTotals({ from: addDays(today, -89), to: today });
    expect(cost).toBe("600.00");
    expect(h.stockValue).toBe("5400.00");
    expect(h.daysOfStock).toBe(810);
  });

  it("has the same stock value as the stock list", async () => {
    await makePart({ qty: 4, avgCost: "250.00" });
    await makePart({ qty: 7, avgCost: "99.99" });

    const listed = fmt(sum((await stockList(admin, {})).map((r) => D(r.stockValue ?? "0"))));
    expect((await getStockHealth(admin)).stockValue).toBe(listed);
  });

  it("refuses staff", async () => {
    const staff = await makeUser("staff");
    await expect(getStockHealth(staff)).rejects.toThrow(Forbidden);
  });
});
