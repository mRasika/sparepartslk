"use client";

import { FilePen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDateTime, formatMoney } from "@/lib/format";
import { discardInvoiceDraftAction } from "@/server/actions/invoices";
import type { InvoiceDraftRow } from "@/server/services/invoice-drafts";

/** Unfinished invoices anyone at the counter can pick up again. */
export function DraftList({ drafts }: { drafts: InvoiceDraftRow[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const shown = drafts.filter((d) => !hidden.has(d.id));
  if (shown.length === 0) return null;

  function discard(id: string) {
    setHidden((h) => new Set(h).add(id));
    startTransition(async () => {
      const result = await discardInvoiceDraftAction(id);
      if (!result.ok) {
        toast.error(result.error.message);
        setHidden((h) => {
          const next = new Set(h);
          next.delete(id);
          return next;
        });
        return;
      }
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="drafts-heading" className="mb-6 rounded-lg border bg-card">
      <h2 id="drafts-heading" className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium">
        <FilePen className="size-4 text-muted-foreground" aria-hidden />
        Unfinished invoices ({shown.length})
        <span className="font-normal text-muted-foreground">· kept for 7 days</span>
      </h2>
      <ul className="divide-y">
        {shown.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
            <span className="min-w-40 flex-1 font-medium">{d.customerName}</span>
            <span className="text-muted-foreground">
              {d.lineCount} {d.lineCount === 1 ? "part" : "parts"}
            </span>
            <span className="w-28 text-right tabular-nums">{d.total ? `Rs ${formatMoney(d.total)}` : "–"}</span>
            <span className="w-52 text-xs text-muted-foreground">
              {d.updatedByName}, {formatDateTime(d.updatedAt)}
            </span>
            <span className="flex gap-1">
              <Link href={`/invoices/new?draft=${d.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                Continue
              </Link>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => discard(d.id)}
                aria-label={`Discard draft for ${d.customerName}`}
                title="Discard"
              >
                <Trash2 />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
