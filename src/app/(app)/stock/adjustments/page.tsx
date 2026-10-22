import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { listAdjustments } from "@/server/services/adjustments";

const REASON_LABELS = {
  damage: "Damaged",
  count_correction: "Count correction",
  lost: "Lost",
  other: "Other",
} as const;

export default async function AdjustmentsPage() {
  await requireUser();
  const rows = await listAdjustments();

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Stock adjustments"
        description="Every correction to stock, with who made it and why."
        actions={
          <Link href="/stock/adjustments/new" className={buttonVariants()}>
            <Plus /> Adjust stock
          </Link>
        }
      />
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Changes</TableHead>
              <TableHead className="hidden md:table-cell">By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No adjustments yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.number}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(a.createdAt)}</TableCell>
                <TableCell>
                  {REASON_LABELS[a.reason]}
                  {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                </TableCell>
                <TableCell className="whitespace-normal tabular-nums">
                  {a.items.map((i) => `${i.sku} ${i.qtyChange > 0 ? "+" : ""}${i.qtyChange}`).join(", ")}
                </TableCell>
                <TableCell className="hidden md:table-cell">{a.createdByName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
