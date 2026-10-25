import { addDays } from "@/lib/dates";
import { D, fmt, sum, type Decimal } from "@/lib/money";

export type AgingGroupKey = "not-due" | "1-30" | "31-60" | "61-90" | "90+";

export const AGING_GROUPS: { key: AgingGroupKey; label: string }[] = [
  { key: "not-due", label: "Not due" },
  { key: "1-30", label: "1–30 days" },
  { key: "31-60", label: "31–60 days" },
  { key: "61-90", label: "61–90 days" },
  { key: "90+", label: "Over 90 days" },
];

/** Whole days from the due date to today; 0 or less = not late. */
function daysLate(dueDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

/** Receivables aging by days past the due date (spec §3). */
export function agingGroup(dueDate: string, today: string): AgingGroupKey {
  const late = daysLate(dueDate, today);
  if (late <= 0) return "not-due";
  if (late <= 30) return "1-30";
  if (late <= 60) return "31-60";
  if (late <= 90) return "61-90";
  return "90+";
}

export function isAgingGroupKey(v: string | undefined): v is AgingGroupKey {
  return AGING_GROUPS.some((g) => g.key === v);
}

export type OpenInvoice = { invoiceId: string; customerId: string; customerName: string; dueDate: string; outstanding: string };
export type CustomerFacts = { customerId: string; name: string; creditLimit: string; balance: string; lastPaidOn: string | null };

export type CustomerCreditRow = {
  customerId: string;
  name: string;
  owed: string;
  overdue: string;
  /** 0 when nothing is overdue. */
  oldestDaysLate: number;
  /** null when the customer has no credit limit. */
  limitUsedPct: number | null;
  overLimit: boolean;
  lastPaidOn: string | null;
};

export type CreditSummary = {
  owed: string;
  customersOwing: number;
  overdue: string;
  overduePct: number;
  customersOverdue: number;
  dueSoon: string;
  dueSoonInvoices: number;
  /** null when there were no credit sales in the last 90 days. */
  dso: number | null;
  unappliedCredit: string;
  groups: { key: AgingGroupKey; label: string; amount: string; invoices: number }[];
  customers: CustomerCreditRow[];
};

const pct = (part: Decimal, whole: Decimal) => Number(part.div(whole).times(100).toFixed(0));

/** The figures for Payments › Outstanding from plain data (spec §3). */
export function summarizeCredit(
  input: { today: string; open: OpenInvoice[]; customers: CustomerFacts[]; creditSales90: string },
  by: "owed" | "overdue" = "owed",
): CreditSummary {
  const { today, open } = input;
  const soonUntil = addDays(today, 6);
  const amounts = (xs: OpenInvoice[]) => sum(xs.map((i) => D(i.outstanding)));

  const owed = amounts(open);
  const overdueInvoices = open.filter((i) => daysLate(i.dueDate, today) > 0);
  const overdue = amounts(overdueInvoices);
  const dueSoonInvoices = open.filter((i) => i.dueDate >= today && i.dueDate <= soonUntil);
  const creditSales = D(input.creditSales90);

  const byCustomer = new Map<string, OpenInvoice[]>();
  for (const i of open) byCustomer.set(i.customerId, [...(byCustomer.get(i.customerId) ?? []), i]);
  const facts = new Map(input.customers.map((c) => [c.customerId, c]));

  const customers: CustomerCreditRow[] = [...byCustomer.entries()].map(([customerId, invoices]) => {
    const f = facts.get(customerId);
    const cOwed = amounts(invoices);
    const late = invoices.map((i) => daysLate(i.dueDate, today)).filter((d) => d > 0);
    const limit = D(f?.creditLimit ?? "0");
    return {
      customerId,
      name: invoices[0].customerName,
      owed: fmt(cOwed),
      overdue: fmt(amounts(invoices.filter((i) => daysLate(i.dueDate, today) > 0))),
      oldestDaysLate: late.length ? Math.max(...late) : 0,
      limitUsedPct: limit.greaterThan(0) ? pct(cOwed, limit) : null,
      overLimit: limit.greaterThan(0) && cOwed.greaterThan(limit),
      lastPaidOn: f?.lastPaidOn ?? null,
    };
  });
  customers.sort((a, b) =>
    by === "overdue"
      ? D(b.overdue).comparedTo(a.overdue) || b.oldestDaysLate - a.oldestDaysLate || a.name.localeCompare(b.name)
      : D(b.owed).comparedTo(a.owed) || a.name.localeCompare(b.name),
  );

  // Money paid but not matched to an invoice: open owed above the account balance, per customer.
  const unapplied = sum(
    input.customers.map((c) => {
      const extra = amounts(byCustomer.get(c.customerId) ?? []).minus(c.balance);
      return extra.greaterThan(0) ? extra : D(0);
    }),
  );

  return {
    owed: fmt(owed),
    customersOwing: byCustomer.size,
    overdue: fmt(overdue),
    overduePct: owed.greaterThan(0) ? pct(overdue, owed) : 0,
    customersOverdue: new Set(overdueInvoices.map((i) => i.customerId)).size,
    dueSoon: fmt(amounts(dueSoonInvoices)),
    dueSoonInvoices: dueSoonInvoices.length,
    dso: creditSales.greaterThan(0) ? Number(owed.div(creditSales).times(90).toFixed(0)) : null,
    unappliedCredit: fmt(unapplied),
    groups: AGING_GROUPS.map((g) => {
      const inGroup = open.filter((i) => agingGroup(i.dueDate, today) === g.key);
      return { ...g, amount: fmt(amounts(inGroup)), invoices: inGroup.length };
    }),
    customers,
  };
}
