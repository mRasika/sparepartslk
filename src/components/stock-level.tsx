import { OctagonAlert, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Quantity on hand, as a word when it needs action: "Out of stock" or "Low · 3 left" for a part with
 * a reorder level at or above its stock. Every other count stays a plain number.
 */
export function StockLevel({ qty, reorderLevel, active = true }: { qty: number; reorderLevel: number; active?: boolean }) {
  if (active && reorderLevel > 0 && qty <= 0) {
    return (
      <Badge variant="destructive" title={`Reorder at ${reorderLevel}`}>
        <OctagonAlert aria-hidden /> Out of stock
      </Badge>
    );
  }
  if (active && reorderLevel > 0 && qty <= reorderLevel) {
    return (
      <Badge className="bg-warning/20 text-warning-foreground" title={`Reorder at ${reorderLevel}`}>
        <TriangleAlert aria-hidden /> Low · {qty} left
      </Badge>
    );
  }
  return <span className="tabular-nums">{qty}</span>;
}
