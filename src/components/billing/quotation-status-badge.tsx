import { Badge } from "@/components/ui/badge";
import { QUOTATION_STATUS_LABEL, type QuotationStatus } from "@/lib/quotations";

export function QuotationStatusBadge({
  status,
  invoiceNumber,
}: {
  status: QuotationStatus;
  invoiceNumber?: string | null;
}) {
  switch (status) {
    case "open":
      return <Badge variant="secondary">{QUOTATION_STATUS_LABEL.open}</Badge>;
    case "expired":
      return (
        <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          {QUOTATION_STATUS_LABEL.expired}
        </Badge>
      );
    case "converted":
      return (
        <Badge>
          {QUOTATION_STATUS_LABEL.converted}
          {invoiceNumber ? ` → ${invoiceNumber}` : ""}
        </Badge>
      );
    case "cancelled":
      return <Badge variant="destructive">{QUOTATION_STATUS_LABEL.cancelled}</Badge>;
  }
}
