import { ChevronRight, CircleCheck, Clock, FilePen, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { AttentionItem } from "@/lib/attention";
import { cn } from "@/lib/utils";

const LOOK: Record<AttentionItem["kind"], { icon: LucideIcon; tone: string }> = {
  overdue: { icon: Clock, tone: "text-destructive" },
  lowStock: { icon: TriangleAlert, tone: "text-warning-foreground" },
  drafts: { icon: FilePen, tone: "text-foreground" },
};

/** What to act on now, as a short list; each row links to where it gets done. */
export function NeedsAttention({ items, owedNote }: { items: AttentionItem[]; owedNote: string | null }) {
  return (
    <section aria-labelledby="attention-heading" className="rounded-lg border bg-card">
      <h2
        id="attention-heading"
        className="border-b px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5"
      >
        Needs attention
      </h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-3 px-4 py-4 font-medium sm:px-5">
          <CircleCheck className="size-5 shrink-0 text-chart-3" aria-hidden />
          All clear: nothing overdue, no parts to reorder, no unfinished invoices.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const { icon: Icon, tone } = LOOK[item.kind];
            return (
              <li key={item.kind}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring sm:gap-4 sm:px-5"
                >
                  <Icon className={cn("size-5 shrink-0", item.kind === "drafts" ? "text-muted-foreground" : tone)} aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("font-semibold tabular-nums", tone)}>{item.title}</span>
                    <span className="text-sm text-muted-foreground">{item.detail}</span>
                  </span>
                  <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "hidden sm:inline-flex")}>
                    {item.action}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {owedNote && <p className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">{owedNote}</p>}
    </section>
  );
}
