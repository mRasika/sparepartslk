import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { MoreFigures } from "@/components/more-figures";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { outstandingHref, type AgingGroupKey, type CustomerCreditRow, type CreditSummary as Summary } from "@/lib/aging";
import { colomboDate } from "@/lib/dates";
import { formatDate, formatMoney, formatSince } from "@/lib/format";
import { D, type Decimal } from "@/lib/money";
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

/** Who owes what and how late, above the invoice list (spec §2). */
export function CreditSummary({
  summary: s,
  late,
  by,
  overdueOnly,
}: {
  summary: Summary;
  late: AgingGroupKey | null;
  by: "owed" | "overdue";
  overdueOnly: boolean;
}) {
  const owed = D(s.owed);
  const today = colomboDate();
  // Bars in Who owes are drawn against the largest amount owed, so their lengths compare.
  const largest = s.customers.reduce((max, c) => (D(c.owed).greaterThan(max) ? D(c.owed) : max), D(0));
  return (
    <div className="mb-6 flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4">
        <Tile label="Owed" value={`Rs ${formatMoney(s.owed)}`} note={plural(s.customersOwing, "customer", "customers")} />
        <Tile
          label="Overdue"
          value={`Rs ${formatMoney(s.overdue)}`}
          note={`${s.overduePct}% · ${plural(s.customersOverdue, "customer", "customers")}`}
          tone={D(s.overdue).greaterThan(0) ? "text-destructive" : undefined}
        />
      </dl>
      <MoreFigures>
        <dl className="grid grid-cols-2 gap-4">
          <Tile label="Due in next 7 days" value={`Rs ${formatMoney(s.dueSoon)}`} note={plural(s.dueSoonInvoices, "invoice", "invoices")} />
          <Tile
            label="Days to collect"
            value={s.dso === null ? "—" : plural(s.dso, "day", "days")}
            note={s.dso === null ? "no credit sales in 90 days" : "how long customers take to pay, last 90 days"}
          />
        </dl>
        {D(s.unappliedCredit).greaterThan(0) && (
          <p className="text-sm text-muted-foreground">
            Rs {formatMoney(s.unappliedCredit)} paid in advance, not yet matched to invoices
          </p>
        )}
      </MoreFigures>

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
                  href={outstandingHref({ late, by: key, overdue: overdueOnly })}
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
                <TableHead className="text-right">Owes (Rs)</TableHead>
                <TableHead>Status</TableHead>
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
                  <TableCell className="text-right">
                    <OwedAmount row={c} largest={largest} />
                  </TableCell>
                  <TableCell>
                    <Status row={c} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">
                    {c.lastPaidOn ? (
                      <time dateTime={c.lastPaidOn} title={formatDate(c.lastPaidOn)}>
                        {formatSince(c.lastPaidOn, today)}
                      </time>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-1.5 w-4 rounded-full bg-destructive" /> Late part of what they owe
            </span>
            <span>Open a customer for their invoices and credit limit</span>
          </p>
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

/** The amount owed, with a bar sized against the largest debt; its red part is the overdue amount. */
function OwedAmount({ row: c, largest }: { row: CustomerCreditRow; largest: Decimal }) {
  const overdue = D(c.overdue);
  const share = (amount: Decimal) => (largest.greaterThan(0) ? amount.div(largest).times(100).toFixed(2) : "0");
  const limit = c.limitUsedPct === null ? "Cash only" : `${c.limitUsedPct}% of credit limit`;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="tabular-nums">{formatMoney(c.owed)}</span>
      {overdue.greaterThan(0) && <span className="sr-only">, of which Rs {formatMoney(c.overdue)} overdue</span>}
      <span
        aria-hidden
        title={overdue.greaterThan(0) ? `Rs ${formatMoney(c.overdue)} overdue · ${limit}` : limit}
        className="flex h-1.5 w-24 overflow-hidden rounded-full bg-muted"
      >
        <span className="h-full bg-destructive" style={{ width: `${share(overdue)}%` }} />
        <span className="h-full bg-chart-1" style={{ width: `${share(D(c.owed).minus(overdue))}%` }} />
      </span>
    </span>
  );
}

/** How the customer stands, in words: late (by how long), on time, and over the credit limit. */
function Status({ row: c }: { row: CustomerCreditRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {c.oldestDaysLate > 30 ? (
        <Badge variant="destructive">
          <OctagonAlert aria-hidden /> {plural(c.oldestDaysLate, "day", "days")} late
        </Badge>
      ) : c.oldestDaysLate > 0 ? (
        <Badge className="bg-warning/20 text-warning-foreground">
          <TriangleAlert aria-hidden /> {plural(c.oldestDaysLate, "day", "days")} late
        </Badge>
      ) : (
        <Badge variant="secondary" className="text-muted-foreground">
          <CircleCheck aria-hidden /> On time
        </Badge>
      )}
      {c.overLimit && (
        <Badge className="bg-warning/20 text-warning-foreground">
          <TriangleAlert aria-hidden /> Over limit
        </Badge>
      )}
    </span>
  );
}
