import { D, fmt } from "@/lib/money";

/** Gross profit as a % of net sales, to one decimal ("25.1"); null when there are no positive sales. */
export function marginPct(netSales: string, grossProfit: string): string | null {
  const net = D(netSales);
  if (net.lessThanOrEqualTo(0)) return null;
  return D(grossProfit).div(net).times(100).toFixed(1);
}

/** Change against the earlier period as a whole % ("12", "-8"); null when the earlier value is 0. */
export function pctChange(current: string, previous: string): string | null {
  const prev = D(previous);
  if (prev.isZero()) return null;
  const change = D(current).minus(prev).div(prev.abs()).times(100).toFixed(0);
  return change === "-0" ? "0" : change;
}

/** Margin change in percentage points ("-0.9"); null when either margin is missing. */
export function pointsChange(current: string | null, previous: string | null): string | null {
  if (current === null || previous === null) return null;
  return D(current).minus(previous).toFixed(1);
}

/** Invoice sales per invoice; "0.00" with no invoices. */
export function avgSale(invoiceSales: string, invoiceCount: number): string {
  return invoiceCount === 0 ? "0.00" : fmt(D(invoiceSales).div(invoiceCount));
}
