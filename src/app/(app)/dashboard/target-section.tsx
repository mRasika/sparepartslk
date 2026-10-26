import Link from "next/link";
import { colomboDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { D, fmt } from "@/lib/money";
import { type DayStatus, percentOf, type PlanDay } from "@/lib/sales-target";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/server/auth";
import { type DailyTargetReport, getDailyTargetReport } from "@/server/services/sales-targets";
import { ReportPicker } from "./report-picker";

const rs = (amount: string) => `Rs ${formatMoney(amount)}`;

/** Admin-only: today and the month against the daily sales target (spec §3). */
export async function TargetSection({ user }: { user: SessionUser }) {
  const today = colomboDate();
  let report: DailyTargetReport;
  try {
    report = await getDailyTargetReport(user, today);
  } catch (e) {
    console.error("Sales target failed", e);
    return (
      <Frame today={today}>
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the sales target
        </p>
      </Frame>
    );
  }

  const { day, month } = report;
  if (!month.hasTarget) {
    return (
      <Frame today={today}>
        <p className="text-sm">
          No daily target yet.{" "}
          <Link href="/settings#sales-target" className="font-medium text-primary hover:underline">
            Set a daily target
          </Link>
        </p>
      </Frame>
    );
  }

  return (
    <Frame today={today}>
      <div className="grid gap-4">
        <TodayRow day={day} />
        <MonthRow month={month} />
        <DaySquares days={month.days} today={today} />
      </div>
    </Frame>
  );
}

function Frame({ today, children }: { today: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="target-heading" className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="target-heading" className="text-lg font-semibold tracking-tight">
          Daily target
          <span className="text-sm font-normal text-muted-foreground"> · net sales, excl. VAT</span>
        </h2>
        <ReportPicker today={today} />
      </div>
      {children}
    </section>
  );
}

function TodayRow({ day }: { day: DailyTargetReport["day"] }) {
  if (day.target === null) {
    return (
      <Row label="Today">
        <p className="text-sm">
          Closed today · <span className="tabular-nums">{rs(day.netSales)}</span> sold
        </p>
      </Row>
    );
  }
  const gap = D(day.netSales).minus(day.target);
  const pct = percentOf(day.netSales, day.target);
  return (
    <Row label="Today">
      <p className="text-sm tabular-nums">
        <span className="font-semibold">{rs(day.netSales)}</span> of {rs(day.target)}
      </p>
      <Bar pct={pct} label="Today's sales against target" tone={day.status === "hit" ? "success" : "primary"} />
      <p className="text-sm tabular-nums">
        {pct}% ·{" "}
        {day.status === "hit" ? (
          <span className="font-medium text-success">Hit · {rs(fmt(gap))} over</span>
        ) : (
          <span>In progress · {rs(fmt(gap.negated()))} to go</span>
        )}
      </p>
    </Row>
  );
}

function MonthRow({ month }: { month: DailyTargetReport["month"] }) {
  const trading = month.days.filter((d) => d.target !== null).length;
  const pct = percentOf(month.mtd, month.monthTarget);
  return (
    <Row label="Month">
      <p className="text-sm tabular-nums">
        <span className="font-semibold">{rs(month.mtd)}</span> of {rs(month.monthTarget)} · {trading} trading days
      </p>
      <Bar
        pct={pct}
        pace={percentOf(month.paceTarget, month.monthTarget)}
        label="Month's sales against target"
        tone={month.outcome === "reached" ? "success" : "primary"}
      />
      <p className="text-sm tabular-nums">
        {pct}% · {month.daysHit} of {month.daysCounted} days hit ·{" "}
        {month.outcome === "reached" ? (
          <span className="font-medium text-success">Month target reached</span>
        ) : month.outcome === "missed" ? (
          <span className="text-destructive">
            Missed the month by {rs(fmt(D(month.monthTarget).minus(month.mtd)))}
          </span>
        ) : month.needPerDay ? (
          <span>
            Need {rs(month.needPerDay)} a day for the {month.tradingDaysLeft} trading{" "}
            {month.tradingDaysLeft === 1 ? "day" : "days"} left
          </span>
        ) : (
          <span>Last trading day of the month</span>
        )}
      </p>
    </Row>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[4rem_minmax(0,1fr)] sm:items-start sm:gap-x-4">
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

/** Progress against a target; `pace` marks where sales should be by today. */
function Bar({ pct, pace, label, tone }: { pct: number; pace?: number; label: string; tone: "primary" | "success" }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative h-2.5 rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full", tone === "success" ? "bg-success" : "bg-primary")}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
      {pace !== undefined && pace > 0 && pace < 100 && (
        <div aria-hidden className="absolute -inset-y-1 w-1 rounded-full bg-warning" style={{ left: `${pace}%` }} />
      )}
    </div>
  );
}

const SQUARE: Record<DayStatus, string> = {
  hit: "bg-success",
  missed: "bg-destructive",
  "in-progress": "bg-muted-foreground/30",
  upcoming: "border border-border",
  closed: "bg-muted-foreground/30",
  "no-target": "bg-muted-foreground/30",
};

const WORDS: Record<DayStatus, string> = {
  hit: "hit",
  missed: "missed",
  "in-progress": "in progress",
  upcoming: "to come",
  closed: "closed",
  "no-target": "no target",
};

function dayLabel(d: PlanDay): string {
  const date = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  if (d.target === null || d.status === "upcoming") return `${date}: ${WORDS[d.status]}`;
  return `${date}: ${rs(d.sales)} of ${rs(d.target)} — ${WORDS[d.status]}`;
}

function DaySquares({ days, today }: { days: PlanDay[]; today: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-x-4">
      <span aria-hidden />
      <div className="grid gap-2">
        <ul aria-label="Days this month" className="flex flex-wrap gap-1">
          {days.map((d) => (
            <li
              key={d.date}
              title={dayLabel(d)}
              aria-label={dayLabel(d)}
              className={cn("size-4 rounded-sm", SQUARE[d.status], d.date === today && "ring-2 ring-ring ring-offset-1")}
            />
          ))}
        </ul>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Legend className="bg-success" text="Hit" />
          <Legend className="bg-destructive" text="Missed" />
          <Legend className="bg-muted-foreground/30" text="Closed or no target" />
          <Legend className="bg-warning" text="Where sales should be today" />
          <Legend className="border border-border" text="To come" />
        </p>
      </div>
    </div>
  );
}

function Legend({ className, text }: { className: string; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden className={cn("size-2.5 rounded-sm", className)} />
      {text}
    </span>
  );
}

export function TargetSectionSkeleton() {
  return (
    <section aria-label="Loading sales target" className="animate-pulse rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-4 h-7 w-40 rounded-md bg-muted" />
      <div className="grid gap-3">
        <div className="h-12 rounded-md bg-muted" />
        <div className="h-12 rounded-md bg-muted" />
      </div>
    </section>
  );
}
