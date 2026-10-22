import { D, fmt } from "@/lib/money";

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Spreads a payment over open invoices in the order given (callers pass oldest due first),
 * each up to what it still owes. Shared by the server and the payment form's preview.
 */
export function autoAllocate(
  amount: string,
  open: { invoiceId: string; outstanding: string }[],
): { allocations: { invoiceId: string; amount: string }[]; unapplied: string } {
  if (!AMOUNT.test(amount.trim())) return { allocations: [], unapplied: "0.00" };
  let remaining = D(amount.trim());
  const allocations: { invoiceId: string; amount: string }[] = [];
  for (const inv of open) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const take = D(inv.outstanding).lessThan(remaining) ? D(inv.outstanding) : remaining;
    if (take.greaterThan(0)) allocations.push({ invoiceId: inv.invoiceId, amount: fmt(take) });
    remaining = remaining.minus(take);
  }
  return { allocations, unapplied: fmt(remaining) };
}
