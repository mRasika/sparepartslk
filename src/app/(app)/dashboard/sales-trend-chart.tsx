"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { formatMoney } from "@/lib/format";
import { D, fmt } from "@/lib/money";
import { type Bucket, bucketLabel } from "@/lib/periods";
import type { TrendPoint } from "@/server/services/sales-analytics";

const config = {
  netSales: { label: "Net sales", color: "var(--chart-1)" },
  grossProfit: { label: "Gross profit", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** 120000 → "120k", 1500000 → "1.5M". */
function shortMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/** Net sales as bars and gross profit as a line, per day, week or month. */
export function SalesTrendChart({ points, bucket }: { points: TrendPoint[]; bucket: Bucket }) {
  const empty = points.every((p) => Number(p.netSales) === 0 && Number(p.grossProfit) === 0);
  const withYear = points.length > 0 && points[0].bucketStart.slice(0, 4) !== points.at(-1)!.bucketStart.slice(0, 4);
  // Numbers are for plotting only; the tooltip shows the exact amounts.
  const data = points.map((p) => ({
    label: bucketLabel(p.bucketStart, bucket, withYear),
    netSales: Number(p.netSales),
    grossProfit: Number(p.grossProfit),
    exact: p,
  }));

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm text-muted-foreground">Sales and profit by {bucket}</h3>
        {!empty && (
          <p className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-chart-1" aria-hidden /> Net sales
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded bg-chart-2" aria-hidden /> Gross profit
            </span>
          </p>
        )}
      </div>
      {empty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No sales in this period</p>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={shortMoney} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <ChartTooltip content={<TrendTooltip />} />
            <Bar dataKey="netSales" fill="var(--color-netSales)" radius={[4, 4, 0, 0]} />
            <Line
              dataKey="grossProfit"
              stroke="var(--color-grossProfit)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              type="linear"
            />
          </ComposedChart>
        </ChartContainer>
      )}
    </div>
  );
}

/**
 * One bucket's exact amounts. When returns were dated in it, sales and returns are shown apart, so a
 * low or negative bar explains itself (returns count on their own date, not on the sale's).
 */
function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: { exact: TrendPoint } }[];
  label?: string;
}) {
  const p = payload?.[0]?.payload.exact;
  if (!active || !p) return null;
  const returned = D(p.returns).greaterThan(0);
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{label}</p>
      {returned && (
        <>
          <TooltipRow label="Sales" value={`Rs ${formatMoney(fmt(D(p.netSales).plus(p.returns)))}`} />
          <TooltipRow label="Returns" value={`−Rs ${formatMoney(p.returns)}`} className="text-destructive" />
        </>
      )}
      <TooltipRow label="Net sales" value={`Rs ${formatMoney(p.netSales)}`} swatch="bg-chart-1" strong={returned} />
      <TooltipRow label="Gross profit" value={`Rs ${formatMoney(p.grossProfit)}`} swatch="bg-chart-2" />
    </div>
  );
}

function TooltipRow({
  label,
  value,
  swatch,
  strong,
  className,
}: {
  label: string;
  value: string;
  swatch?: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex w-full items-center justify-between gap-4 ${strong ? "border-t pt-1.5" : ""}`}>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {swatch ? <span aria-hidden className={`size-2.5 rounded-sm ${swatch}`} /> : <span aria-hidden className="size-2.5" />}
        {label}
      </span>
      <span className={`font-mono font-medium tabular-nums ${className ?? ""}`}>{value}</span>
    </div>
  );
}
