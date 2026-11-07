import { formatMoney, formatRsShort } from "@/lib/format";

/** A summary amount read at a glance ("Rs 3.4M"), with the exact amount on hover. */
export function Amount({ value, className }: { value: string; className?: string }) {
  return (
    <span title={`Rs ${formatMoney(value)}`} className={className}>
      {formatRsShort(value)}
    </span>
  );
}
