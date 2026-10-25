import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AgingGroupKey, CreditSummary as Summary } from "@/lib/aging";
import { formatDate, formatMoney } from "@/lib/format";
import { D } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Bar colours per aging group: not due neutral, then one blue ramp getting stronger. */
const GROUP_COLOR: Record<AgingGroupKey, string> = {
  "not-due": "bg-muted-foreground/40",
  "1-30": "bg-aging-1",
  "31-60": "bg-aging-2",
  "61-90": "bg-aging-3",
  "90+": "bg-aging-4",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Outstanding view URL with only the params that differ from the defaults. */
export function outstandingHref(p: { late?: AgingGroupKey | null; by?: "owed" | "overdue" }): string {
  const q = new URLSearchParams({ view: "outstanding" });
  if (p.late) q.set("late", p.late);
  if (p.by === "overdue") q.set("by", "overdue");
  return `/payments?${q}`;
}

/** Who owes what and how late, above the invoice list (spec §2). */
export function CreditSummary({ summary: s, late, by }: { summary: Summary; late: AgingGroupKey | null; by: "owed" | "overdue" }) {
  const owed = D(s.owed);
  return (
    <div className="mb-6 flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Owed" value={`Rs ${formatMoney(s.owed)}`} note={plural(s.customersOwing, "customer", "customers")} />
        <Tile
          label="Overdue"
          value={`Rs ${formatMoney(s.overdue)}`}
          note={`${s.overduePct}% · ${plural(s.customersOverdue, "customer", "customers")}`}
          tone={D(s.overdue).greaterThan(0) ? "text-destructive" : undefined}
        />
        <Tile label="Due in next 7 days" value={`Rs ${formatMoney(s.dueSoon)}`} note={plural(s.dueSoonInvoices, "invoice", "invoices")} />
        <Tile
          label="Days to collect"
          value={s.dso === null ? "—" : plural(s.dso, "day", "days")}
          note={s.dso === null ? "no credit sales in 90 days" : "last 90 days"}
        />
      </dl>
      {D(s.unappliedCredit).greaterThan(0) && (
        <p className="text-sm text-muted-foreground">
          Rs {formatMoney(s.unappliedCredit)} paid in advance, not yet matched to invoices
        </p>
      )}

      {owed.greaterThan(0) && (
        <section aria-labelledby="how-late" className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 id="how-late" className="text-sm text-muted-foreground">
            How late
          </h2>
          <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {s.groups
              .filter((g) => D(g.amount).greaterThan(0))
              .map((g) => (
                <div key={g.key} className={GROUP_COLOR[g.key]} style={{ width: `${D(g.amount).div(owed).times(100).toFixed(2)}%` }} />
              ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-1 text-sm">
            {s.groups.map((g) => (
              <li key={g.key}>
                <Link
                  href={outstandingHref({ late: g.key, by })}
                  scroll={false}
                  aria-current={late === g.key ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 tabular-nums hover:bg-muted",
                    late === g.key && "bg-muted font-medium",
                  )}
                >
                  <span className={cn("inline-block size-2.5 rounded-sm", GROUP_COLOR[g.key])} aria-hidden />
                  {g.label} · Rs {formatMoney(g.amount)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.customers.length > 0 && (
        <section aria-labelledby="who-owes" className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <h2 id="who-owes" className="px-1 font-semibold">
              Who owes
            </h2>
            <nav aria-label="Sort customers" className="flex gap-1">
              {(["owed", "overdue"] as const).map((key) => (
                <Link
                  key={key}
                  href={outstandingHref({ late, by: key })}
                  scroll={false}
                  aria-current={by === key ? "page" : undefined}
                  className={buttonVariants({ variant: by === key ? "secondary" : "ghost", size: "sm" })}
                >
                  {key === "owed" ? "Most owed" : "Most overdue"}
                </Link>
              ))}
            </nav>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="hidden text-right md:table-cell">Oldest late</TableHead>
                <TableHead>Credit limit used</TableHead>
                <TableHead className="hidden md:table-cell">Last paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.customers.map((c) => (
                <TableRow key={c.customerId}>
                  <TableCell className="font-medium">
                    <Link href={`/customers/${c.customerId}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">Rs {formatMoney(c.owed)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", D(c.overdue).greaterThan(0) && "font-medium text-destructive")}>
                    {D(c.overdue).greaterThan(0) ? `Rs ${formatMoney(c.overdue)}` : "—"}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {c.oldestDaysLate > 0 ? plural(c.oldestDaysLate, "day", "days") : "—"}
                  </TableCell>
                  <TableCell>
                    <LimitUsed pct={c.limitUsedPct} over={c.overLimit} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">
                    {c.lastPaidOn ? formatDate(c.lastPaidOn) : "Never"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("mt-2 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl", tone)}>{value}</dd>
      <dd className="mt-1 text-sm text-muted-foreground">{note}</dd>
    </div>
  );
}

function LimitUsed({ pct, over }: { pct: number | null; over: boolean }) {
  if (pct === null) return <span className="text-sm text-muted-foreground">No limit set</span>;
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full", over ? "bg-destructive" : "bg-chart-1")} style={{ width: `${Math.min(pct, 100)}%` }} />
      </span>
      <span className="text-sm tabular-nums">{pct}%</span>
      {over && <Badge variant="destructive">Over limit</Badge>}
    </span>
  );
}
