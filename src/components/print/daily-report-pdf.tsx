import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDateTime, formatMoney } from "@/lib/format";
import { D, fmt } from "@/lib/money";
import { percentOf, type DayStatus } from "@/lib/sales-target";
import { pctChange } from "@/lib/sales-metrics";
import type { DailyTargetReport } from "@/server/services/sales-targets";

const s = StyleSheet.create({
  page: { padding: 34, paddingBottom: 50, fontSize: 9.5, fontFamily: "Helvetica", color: "#111" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottom: "1.5pt solid #111", paddingBottom: 10 },
  bizName: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", textAlign: "right", marginBottom: 4 },
  right: { textAlign: "right" },
  small: { fontSize: 8, color: "#555" },
  bold: { fontFamily: "Helvetica-Bold" },
  section: { marginTop: 14 },
  heading: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  status: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, paddingRight: 16 },
  label: { color: "#555" },
  th: { flexDirection: "row", borderBottom: "1pt solid #111", paddingVertical: 4, fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  tr: { flexDirection: "row", borderBottom: "0.5pt solid #ccc", paddingVertical: 3 },
  total: { flexDirection: "row", borderTop: "1pt solid #111", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  cDate: { width: "22%" },
  cDay: { width: "14%" },
  cSales: { width: "22%", textAlign: "right" },
  cTarget: { width: "22%", textAlign: "right" },
  cStatus: { width: "20%", textAlign: "right" },
  foot: { position: "absolute", bottom: 24, left: 34, right: 34, fontSize: 8, color: "#555" },
});

const rs = (amount: string) => `Rs ${formatMoney(amount)}`;

const STATUS: Record<DayStatus, string> = {
  hit: "HIT",
  missed: "MISSED",
  "in-progress": "IN PROGRESS",
  upcoming: "",
  closed: "CLOSED",
  "no-target": "NO TARGET",
};

const longDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const shortDate = (date: string, part: "date" | "weekday") =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(
    "en-GB",
    part === "date" ? { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" } : { weekday: "short", timeZone: "UTC" },
  );

/** "+12%" / "-5%"; the standard PDF fonts have no arrow glyphs. */
function change(current: string, before: string, none: string): string {
  const pct = pctChange(current, before);
  return pct === null ? none : `${pct.startsWith("-") ? "" : "+"}${pct}%`;
}

/** The daily sales report (spec §5). */
export function DailyReportPdf({ data, printedAt }: { data: DailyTargetReport; printedAt: Date }) {
  const { day, month } = data;
  const gap = day.target === null ? null : D(day.netSales).minus(day.target);
  const rows = month.days.filter((d) => d.date <= data.date);

  return (
    <Document title={`Daily sales report ${data.date}`} author={data.business.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.bizName}>{data.business.name}</Text>
            {data.business.address ? <Text>{data.business.address}</Text> : null}
            {data.business.phone ? <Text>{data.business.phone}</Text> : null}
          </View>
          <View>
            <Text style={s.title}>Daily sales report</Text>
            <Text style={[s.right, s.bold]}>{longDate(data.date)}</Text>
            <Text style={[s.right, s.small]}>Printed {formatDateTime(printedAt)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.heading}>The day</Text>
          <Text style={s.status}>
            {STATUS[day.status]}
            {gap !== null && day.status !== "closed"
              ? gap.gte(0)
                ? `  ·  ${rs(fmt(gap))} over`
                : `  ·  ${rs(fmt(gap.negated()))} ${day.status === "in-progress" ? "to go" : "short"}`
              : ""}
          </Text>
          <View style={s.grid}>
            <Cell label="Net sales" value={rs(day.netSales)} />
            <Cell label="Target" value={day.target === null ? "-" : rs(day.target)} />
            <Cell label="Invoices" value={String(day.invoiceCount)} />
            <Cell label="Average sale" value={rs(day.avgSale)} />
            <Cell label="Cash sales" value={rs(day.cashSales)} />
            <Cell label="Credit sales" value={rs(day.creditSales)} />
            <Cell label="Money collected" value={rs(day.collected)} />
            <Cell
              label={`${shortDate(data.date, "weekday")} last week`}
              value={`${rs(day.lastWeekSales)} (${change(day.netSales, day.lastWeekSales, "No sales then")})`}
            />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.heading}>The month so far</Text>
          <View style={s.grid}>
            <Cell label="Sales to date" value={rs(month.mtd)} />
            <Cell label="Month target" value={month.hasTarget ? rs(month.monthTarget) : "No target set"} />
            <Cell label="Of month target" value={month.hasTarget ? `${percentOf(month.mtd, month.monthTarget)}%` : "-"} />
            <Cell label="Days hit" value={`${month.daysHit} of ${month.daysCounted}`} />
            <Cell label="Still needed" value={needLine(month)} />
            <Cell
              label="Same days last month"
              value={`${rs(month.lastMonthMtd)} (${change(month.mtd, month.lastMonthMtd, "No sales then")})`}
            />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.heading}>Day by day</Text>
          <View style={s.th}>
            <Text style={s.cDate}>Date</Text>
            <Text style={s.cDay}>Day</Text>
            <Text style={s.cSales}>Net sales</Text>
            <Text style={s.cTarget}>Target</Text>
            <Text style={s.cStatus}>Status</Text>
          </View>
          {rows.map((d) => (
            <View key={d.date} style={s.tr} wrap={false}>
              <Text style={s.cDate}>{shortDate(d.date, "date")}</Text>
              <Text style={s.cDay}>{shortDate(d.date, "weekday")}</Text>
              <Text style={s.cSales}>{formatMoney(d.sales)}</Text>
              <Text style={s.cTarget}>{d.target === null ? "-" : formatMoney(d.target)}</Text>
              <Text style={s.cStatus}>{STATUS[d.status]}</Text>
            </View>
          ))}
          <View style={s.total}>
            <Text style={s.cDate}>Total</Text>
            <Text style={s.cDay} />
            <Text style={s.cSales}>{formatMoney(month.mtd)}</Text>
            <Text style={s.cTarget}>{formatMoney(month.paceTarget)}</Text>
            <Text style={s.cStatus} />
          </View>
        </View>

        <Text style={s.foot} fixed>
          Net sales exclude VAT and are after returns. Money collected includes VAT.
        </Text>
      </Page>
    </Document>
  );
}

function needLine(month: DailyTargetReport["month"]): string {
  if (!month.hasTarget) return "-";
  if (month.outcome === "reached") return "Month target reached";
  if (month.outcome === "missed") return `Missed the month by ${rs(fmt(D(month.monthTarget).minus(month.mtd)))}`;
  if (month.needPerDay) return `${rs(month.needPerDay)} a day for ${month.tradingDaysLeft} days`;
  return "Last trading day";
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.cell}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.bold}>{value}</Text>
    </View>
  );
}
