import { formatMoney } from "@/lib/format";
import { D } from "@/lib/money";

export type AttentionItem = {
  kind: "overdue" | "lowStock" | "drafts";
  title: string;
  detail: string;
  action: string;
  href: string;
};

/**
 * The dashboard's "Needs attention" list: only rows with something to do, most urgent first.
 * `owedNote` mentions money owed when none of it is overdue, so it isn't lost with the row.
 */
export function attentionItems(d: {
  totalOutstanding: string;
  totalOverdue: string;
  lowStockCount: number;
  draftCount: number;
}): { items: AttentionItem[]; owedNote: string | null } {
  const items: AttentionItem[] = [];
  const owed = D(d.totalOutstanding).greaterThan(0);
  const overdue = D(d.totalOverdue).greaterThan(0);
  if (overdue) {
    items.push({
      kind: "overdue",
      title: `Rs ${formatMoney(d.totalOverdue)} overdue`,
      detail: `Customers owe Rs ${formatMoney(d.totalOutstanding)} in total`,
      action: "Collect payments",
      href: "/payments?view=outstanding&overdue=1",
    });
  }
  if (d.lowStockCount > 0) {
    items.push({
      kind: "lowStock",
      title: `${d.lowStockCount} ${d.lowStockCount === 1 ? "part" : "parts"} to reorder`,
      detail: "At or below their reorder level",
      action: "Reorder",
      href: "/low-stock",
    });
  }
  if (d.draftCount > 0) {
    items.push({
      kind: "drafts",
      title: `${d.draftCount} unfinished ${d.draftCount === 1 ? "invoice" : "invoices"}`,
      detail: "Auto-saved, not issued yet",
      action: "Continue",
      href: "/invoices/new",
    });
  }
  const owedNote =
    owed && !overdue ? `Customers owe Rs ${formatMoney(d.totalOutstanding)} in total, none of it overdue.` : null;
  return { items, owedNote };
}
