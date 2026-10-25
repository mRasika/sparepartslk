import { colomboDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { D } from "@/lib/money";
import { formatRange, PERIOD_PRESETS, resolvePeriod } from "@/lib/periods";
import { avgSale, marginPct, pctChange, pointsChange } from "@/lib/sales-metrics";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/server/auth";
import {
  getSalesAnalytics,
  type SalesAnalytics,
  type SalesTotals,
  type TopDimension,
  type TopSort,
} from "@/server/services/sales-analytics";
import { PeriodPicker } from "./period-picker";

export type SalesParams = { period?: string; from?: string; to?: string; top?: string; sort?: string };

const DIMENSIONS: TopDimension[] = ["parts", "categories", "brands", "models"];
const SORTS: TopSort[] = ["sales", "profit"];

/** Dashboard URL with only the params that differ from the defaults. */
function dashboardHref(params: SalesParams): string {
  const q = new URLSearchParams();
  if (params.from && params.to) {
    q.set("from", params.from);
    q.set("to", params.to);
  } else if (params.period && params.period !== "month") {
    q.set("period", params.period);
  }
  if (params.top && params.top !== "parts") q.set("top", params.top);
  if (params.sort && params.sort !== "sales") q.set("sort", params.sort);
  const s = q.toString();
  return s ? `/dashboard?${s}` : "/dashboard";
}

/** Admin-only sales & profit for the chosen period (spec §2). */
export async function SalesSection({ user, params }: { user: SessionUser; params: SalesParams }) {
  const today = colomboDate();
  const period = resolvePeriod(params, today);
  const top = DIMENSIONS.find((d) => d === params.top) ?? "parts";
  const sort = SORTS.find((s) => s === params.sort) ?? "sales";

  let data: SalesAnalytics;
  try {
    data = await getSalesAnalytics(user, period, { dimension: top, sort });
  } catch (e) {
    console.error("Sales analytics failed", e);
    return (
      <SectionFrame>
        <p role="alert" className="rounded-lg border bg-card p-5 text-sm text-destructive">
          Couldn&apos;t load sales figures
        </p>
      </SectionFrame>
    );
  }

  const keep: Record<string, string> = {};
  if (top !== "parts") keep.top = top;
  if (sort !== "sales") keep.sort = sort;
  const compareLabel = formatRange(period.compare, today);

  return (
    <SectionFrame
      picker={
        <PeriodPicker
          presets={PERIOD_PRESETS.map((p) => ({
            label: p.label,
            href: dashboardHref({ period: p.value, top, sort }),
            active: period.preset === p.value,
          }))}
          custom={{
            active: period.preset === "custom",
            label: formatRange(period.range, today),
            from: period.range.from,
            to: period.range.to,
          }}
          today={today}
          keep={keep}
        />
      }
    >
      <KpiTiles current={data.current} previous={data.previous} compareLabel={compareLabel} />
      {/* trend chart: Task 5 */}
      <CashCredit totals={data.current} />
      {/* top sellers: Task 5 */}
    </SectionFrame>
  );
}

function SectionFrame({ picker, children }: { picker?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby="sales-heading" className="mt-10">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="sales-heading" className="text-lg font-semibold tracking-tight">
          Sales &amp; profit
        </h2>
        {picker}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function KpiTiles({ current, previous, compareLabel }: { current: SalesTotals; previous: SalesTotals; compareLabel: string }) {
  const margin = marginPct(current.netSales, current.grossProfit);
  const marginBefore = marginPct(previous.netSales, previous.grossProfit);
  const points = pointsChange(margin, marginBefore);
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat
        label="Net sales"
        value={`Rs ${formatMoney(current.netSales)}`}
        change={<Change pct={pctChange(current.netSales, previous.netSales)} suffix={` vs ${compareLabel}`} />}
      />
      <Stat
        label="Gross profit"
        value={`Rs ${formatMoney(current.grossProfit)}`}
        change={<Change pct={pctChange(current.grossProfit, previous.grossProfit)} />}
      />
      <Stat
        label="Margin"
        value={margin === null ? "—" : `${margin}%`}
        change={points === null ? null : <Direction value={points} text={`${D(points).abs().toFixed(1)} pts`} />}
      />
      <Stat
        label="Avg sale"
        value={`Rs ${formatMoney(avgSale(current.invoiceSales, current.invoiceCount))}`}
        change={
          <span className="text-muted-foreground">
            {current.invoiceCount} {current.invoiceCount === 1 ? "invoice" : "invoices"}
          </span>
        }
      />
    </dl>
  );
}

function Stat({ label, value, change }: { label: string; value: string; change: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{value}</dd>
      <dd className="mt-1 text-sm">{change}</dd>
    </div>
  );
}

function Change({ pct, suffix = "" }: { pct: string | null; suffix?: string }) {
  if (pct === null) return <span className="text-muted-foreground">No sales before</span>;
  return <Direction value={pct} text={`${D(pct).abs().toString()}%${suffix}`} />;
}

/** ▲ / ▼ with the size of the change; falls are shown in the destructive colour. */
function Direction({ value, text }: { value: string; text: string }) {
  const down = D(value).isNegative() && !D(value).isZero();
  return (
    <span className={cn("font-medium", down ? "text-destructive" : "text-foreground")}>
      <span aria-hidden>{down ? "▼" : "▲"}</span>
      <span className="sr-only">{down ? "Down" : "Up"}</span> {text}
    </span>
  );
}

function CashCredit({ totals }: { totals: SalesTotals }) {
  const total = D(totals.invoiceSales);
  if (total.lessThanOrEqualTo(0)) {
    return (
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <h3 className="text-sm text-muted-foreground">Cash vs credit</h3>
        <p className="mt-2 text-sm text-muted-foreground">No sales in this period</p>
      </div>
    );
  }
  const cashPct = Number(D(totals.cashSales).div(total).times(100).toFixed(0));
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <h3 className="text-sm text-muted-foreground">Cash vs credit</h3>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="bg-primary" style={{ width: `${cashPct}%` }} />
        <div className="bg-chart-2" style={{ width: `${100 - cashPct}%` }} />
      </div>
      <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm tabular-nums">
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-primary" aria-hidden />
          Cash {cashPct}% · Rs {formatMoney(totals.cashSales)}
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2 rounded-full bg-chart-2" aria-hidden />
          Credit {100 - cashPct}% · Rs {formatMoney(totals.creditSales)}
        </span>
      </p>
    </div>
  );
}

export function SalesSectionSkeleton() {
  return (
    <section aria-label="Loading sales" className="mt-10 animate-pulse">
      <div className="mb-4 h-7 w-40 rounded-md bg-muted" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-card" />
        ))}
      </div>
      <div className="mt-4 h-72 rounded-lg border bg-card" />
    </section>
  );
}
