import { describe, expect, it } from "vitest";
import { attentionItems } from "@/lib/attention";

const none = { totalOutstanding: "0.00", totalOverdue: "0.00", lowStockCount: 0, draftCount: 0 };

describe("attentionItems", () => {
  it("lists overdue money, parts to reorder and unfinished invoices, in that order", () => {
    const a = attentionItems({ totalOutstanding: "81508.50", totalOverdue: "11170.00", lowStockCount: 5, draftCount: 4 });
    expect(a.items).toEqual([
      {
        kind: "overdue",
        title: "Rs 11,170.00 overdue",
        detail: "Customers owe Rs 81,508.50 in total",
        action: "Collect payments",
        href: "/payments?view=outstanding&overdue=1",
      },
      {
        kind: "lowStock",
        title: "5 parts to reorder",
        detail: "At or below their reorder level",
        action: "Reorder",
        href: "/low-stock",
      },
      {
        kind: "drafts",
        title: "4 unfinished invoices",
        detail: "Auto-saved, not issued yet",
        action: "Continue",
        href: "/invoices/new",
      },
    ]);
    expect(a.owedNote).toBeNull();
  });

  it("leaves out rows with nothing to do", () => {
    expect(attentionItems({ ...none, lowStockCount: 2 }).items.map((i) => i.kind)).toEqual(["lowStock"]);
  });

  it("uses the singular for one", () => {
    const a = attentionItems({ ...none, lowStockCount: 1, draftCount: 1 });
    expect(a.items.map((i) => i.title)).toEqual(["1 part to reorder", "1 unfinished invoice"]);
  });

  it("is empty when nothing needs attention", () => {
    expect(attentionItems(none)).toEqual({ items: [], owedNote: null });
  });

  it("still mentions money owed when none of it is overdue", () => {
    expect(attentionItems({ ...none, totalOutstanding: "81508.50" }).owedNote).toBe(
      "Customers owe Rs 81,508.50 in total, none of it overdue.",
    );
  });
});
