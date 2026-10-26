import { and, asc, between, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { addDays, colomboDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { D, fmt } from "@/lib/money";
import { isDate, resolvePeriod } from "@/lib/periods";
import { type DayStatus, monthPlan, type MonthPlan, type TargetRow } from "@/lib/sales-target";
import { moneyString, optionalText } from "@/lib/validation";
import { requireRole, type SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { closedDays, payments, salesTargets } from "@/server/db/schema";
import { InvalidState, NotFound } from "@/server/errors";
import { getSalesTotals, getSalesTrend } from "@/server/services/sales-analytics";
import { getSettings } from "@/server/services/settings";

export const salesTargetInputSchema = z.object({
  dailyTarget: moneyString
    .refine((v) => D(v).gt(0), "Enter a target above 0")
    .refine((v) => D(v).lte("99999999.99"), "That target is too large"),
  closedWeekdays: z
    .array(z.coerce.number().int().min(1).max(7))
    .max(6, "Keep at least one day open")
    .refine((days) => new Set(days).size === days.length, "Each weekday once")
    .transform((days) => [...days].sort()),
});

export type SalesTargetInput = z.input<typeof salesTargetInputSchema>;

export const closedDayInputSchema = z.object({
  day: z.string().refine((v) => isDate(v), "Choose a date"),
  reason: optionalText(100),
});

export type ClosedDayInput = z.input<typeof closedDayInputSchema>;

export type TargetSettings = {
  current: (TargetRow & { createdAt: Date }) | null;
  previous: TargetRow | null;
  /** Today onward. */
  closedDays: { day: string; reason: string | null }[];
};

const targetColumns = {
  effectiveFrom: salesTargets.effectiveFrom,
  dailyTarget: salesTargets.dailyTarget,
  closedWeekdays: salesTargets.closedWeekdays,
  createdAt: salesTargets.createdAt,
};

export async function getTargetSettings(user: SessionUser): Promise<TargetSettings> {
  requireRole(user, "admin");
  const today = colomboDate();
  const [rows, upcoming] = await Promise.all([
    db.select(targetColumns).from(salesTargets).orderBy(desc(salesTargets.effectiveFrom)).limit(2),
    db
      .select({ day: closedDays.day, reason: closedDays.reason })
      .from(closedDays)
      .where(gte(closedDays.day, today))
      .orderBy(asc(closedDays.day)),
  ]);
  const [current, previous] = rows;
  return {
    current: current ?? null,
    previous: previous
      ? { effectiveFrom: previous.effectiveFrom, dailyTarget: previous.dailyTarget, closedWeekdays: previous.closedWeekdays }
      : null,
    closedDays: upcoming,
  };
}

/** The target from today on; saving again the same day replaces today's row (spec §4). */
export async function saveSalesTarget(user: SessionUser, input: SalesTargetInput): Promise<void> {
  requireRole(user, "admin");
  const data = salesTargetInputSchema.parse(input);
  await db
    .insert(salesTargets)
    .values({ effectiveFrom: colomboDate(), ...data, createdBy: user.id })
    .onConflictDoUpdate({
      target: salesTargets.effectiveFrom,
      set: { ...data, createdBy: user.id, createdAt: sql`now()` },
    });
}

/** Only today onward, so a missed day can't be turned into a closed one afterwards. */
export async function addClosedDay(user: SessionUser, input: ClosedDayInput): Promise<void> {
  requireRole(user, "admin");
  const data = closedDayInputSchema.parse(input);
  if (data.day < colomboDate()) throw new InvalidState("Closed dates can't be in the past");
  const added = await db
    .insert(closedDays)
    .values({ ...data, createdBy: user.id })
    .onConflictDoNothing()
    .returning({ day: closedDays.day });
  if (added.length === 0) throw new InvalidState(`${formatDate(data.day)} is already closed`);
}

export async function removeClosedDay(user: SessionUser, day: string): Promise<void> {
  requireRole(user, "admin");
  if (day < colomboDate()) throw new InvalidState("Past closed dates can't be removed");
  const removed = await db.delete(closedDays).where(eq(closedDays.day, day)).returning({ day: closedDays.day });
  if (removed.length === 0) throw new NotFound("That date isn't closed");
}

export type DailyTargetReport = {
  date: string;
  today: string;
  business: { name: string; address: string; phone: string };
  day: {
    netSales: string;
    target: string | null;
    status: DayStatus;
    invoiceCount: number;
    avgSale: string;
    cashSales: string;
    creditSales: string;
    /** Active payments dated that day, refunds included; with VAT. */
    collected: string;
    lastWeekSales: string;
  };
  month: MonthPlan & { lastMonthMtd: string };
};

/** One day against its target, and the month so far (spec §2, §5). */
export async function getDailyTargetReport(user: SessionUser, date: string): Promise<DailyTargetReport> {
  requireRole(user, "admin");
  const today = colomboDate();
  if (!isDate(date) || date > today) throw new InvalidState("Choose a date up to today");
  const first = `${date.slice(0, 8)}01`;
  const last = addDays(`${addDays(first, 31).slice(0, 8)}01`, -1);

  const [settings, rows, closed, dayTotals, lastWeek, lastMonth, trend, [collected]] = await Promise.all([
    getSettings(),
    db
      .select({
        effectiveFrom: salesTargets.effectiveFrom,
        dailyTarget: salesTargets.dailyTarget,
        closedWeekdays: salesTargets.closedWeekdays,
      })
      .from(salesTargets),
    db.select({ day: closedDays.day }).from(closedDays).where(between(closedDays.day, first, last)),
    getSalesTotals({ from: date, to: date }),
    getSalesTotals({ from: addDays(date, -7), to: addDays(date, -7) }),
    getSalesTotals(resolvePeriod({ period: "month" }, date).compare),
    getSalesTrend({ from: first, to: date }, "day"),
    db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)::numeric(12, 2)::text` })
      .from(payments)
      .where(and(eq(payments.paymentDate, date), eq(payments.status, "active"))),
  ]);

  const plan = monthPlan({
    reportDate: date,
    today,
    rows,
    closedDays: closed.map((c) => c.day),
    dailySales: Object.fromEntries(trend.map((p) => [p.bucketStart, p.netSales])),
  });
  const planDay = plan.days.find((d) => d.date === date)!;

  return {
    date,
    today,
    business: { name: settings.businessName, address: settings.address, phone: settings.phone },
    day: {
      netSales: dayTotals.netSales,
      target: planDay.target,
      status: planDay.status,
      invoiceCount: dayTotals.invoiceCount,
      avgSale: dayTotals.invoiceCount ? fmt(D(dayTotals.invoiceSales).div(dayTotals.invoiceCount)) : "0.00",
      cashSales: dayTotals.cashSales,
      creditSales: dayTotals.creditSales,
      collected: collected.total,
      lastWeekSales: lastWeek.netSales,
    },
    month: { ...plan, lastMonthMtd: lastMonth.netSales },
  };
}
