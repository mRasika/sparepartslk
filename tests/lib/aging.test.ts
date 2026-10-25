import { describe, expect, it } from "vitest";
import { agingGroup, isAgingGroupKey, summarizeCredit, type CustomerFacts, type OpenInvoice } from "@/lib/aging";
import { addDays } from "@/lib/dates";

const T = "2026-10-25";

const facts: CustomerFacts[] = [
  { customerId: "A", name: "A", creditLimit: "10000.00", balance: "9000.00", lastPaidOn: "2026-10-20" },
  { customerId: "B", name: "B", creditLimit: "0.00", balance: "4500.00", lastPaidOn: null },
  { customerId: "C", name: "C", creditLimit: "0.00", balance: "-500.00", lastPaidOn: "2026-10-01" },
];
const inv = (id: string, customerId: string, due: number, outstanding: string): OpenInvoice => ({
  invoiceId: id,
  customerId,
  customerName: customerId,
  dueDate: addDays(T, due),
  outstanding,
});
const open: OpenInvoice[] = [
  inv("a1", "A", -40, "3000.00"),
  inv("a2", "A", 3, "6000.00"),
  inv("b1", "B", -5, "3500.00"),
  inv("b2", "B", 10, "1000.00"),
  inv("b3", "B", -100, "500.00"),
];

describe("agingGroup", () => {
  it.each([
    ["2026-10-26", "not-due"],
    ["2026-10-25", "not-due"],
    ["2026-10-24", "1-30"],
    ["2026-09-25", "1-30"],
    ["2026-09-24", "31-60"],
    ["2026-08-26", "31-60"],
    ["2026-08-25", "61-90"],
    ["2026-07-27", "61-90"],
    ["2026-07-26", "90+"],
  ])("puts an invoice due %s in %s", (due, group) => {
    expect(agingGroup(due, T)).toBe(group);
  });

  it("recognises group keys", () => {
    expect(isAgingGroupKey("31-60")).toBe(true);
    expect(isAgingGroupKey("abc")).toBe(false);
    expect(isAgingGroupKey(undefined)).toBe(false);
  });
});

describe("summarizeCredit", () => {
  it("summarizes a book", () => {
    const s = summarizeCredit({ today: T, open, customers: facts, creditSales90: "25000.00" });
    expect(s).toMatchObject({
      owed: "14000.00",
      customersOwing: 2,
      overdue: "7000.00",
      overduePct: 50,
      customersOverdue: 2,
      dueSoon: "6000.00",
      dueSoonInvoices: 1,
      dso: 50,
      unappliedCredit: "1000.00",
    });
    expect(s.groups.map((g) => g.amount)).toEqual(["7000.00", "3500.00", "3000.00", "0.00", "500.00"]);
    expect(s.groups.map((g) => g.invoices)).toEqual([2, 1, 1, 0, 1]);
    expect(s.customers).toEqual([
      { customerId: "A", name: "A", owed: "9000.00", overdue: "3000.00", oldestDaysLate: 40, limitUsedPct: 90, overLimit: false, lastPaidOn: "2026-10-20" },
      { customerId: "B", name: "B", owed: "5000.00", overdue: "4000.00", oldestDaysLate: 100, limitUsedPct: null, overLimit: false, lastPaidOn: null },
    ]);
  });

  it("sorts by overdue", () => {
    const s = summarizeCredit({ today: T, open, customers: facts, creditSales90: "25000.00" }, "overdue");
    expect(s.customers.map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("counts due today and today+6 as due soon, not today+7", () => {
    const s = summarizeCredit({
      today: T,
      open: [inv("x", "A", 0, "100.00"), inv("y", "A", 6, "100.00"), inv("z", "A", 7, "100.00")],
      customers: facts,
      creditSales90: "0.00",
    });
    expect(s).toMatchObject({ dueSoon: "200.00", dueSoonInvoices: 2, overdue: "0.00" });
  });

  it("flags over limit", () => {
    const tight = facts.map((f) => (f.customerId === "A" ? { ...f, creditLimit: "8000.00" } : f));
    const s = summarizeCredit({ today: T, open, customers: tight, creditSales90: "25000.00" });
    expect(s.customers.find((c) => c.name === "A")).toMatchObject({ limitUsedPct: 113, overLimit: true });
  });

  it("has no DSO without credit sales", () => {
    expect(summarizeCredit({ today: T, open, customers: facts, creditSales90: "0.00" }).dso).toBeNull();
  });

  it("summarizes an empty book", () => {
    const s = summarizeCredit({ today: T, open: [], customers: [], creditSales90: "0.00" });
    expect(s).toMatchObject({ owed: "0.00", overduePct: 0, customersOwing: 0, dso: null, customers: [] });
    expect(s.groups.map((g) => [g.amount, g.invoices])).toEqual(Array(5).fill(["0.00", 0]));
  });
});
