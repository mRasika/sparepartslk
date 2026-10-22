"use client";

import { Ban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelInvoiceAction } from "@/server/actions/payments";

/** Admin-only: cancels an invoice with a reason. Stock goes back; the number is kept. */
export function CancelInvoiceDialog({ invoiceId, number }: { invoiceId: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelInvoiceAction(invoiceId, reason);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`${number} cancelled. Stock returned.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Ban /> Cancel invoice
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {number}?</DialogTitle>
            <DialogDescription>
              The parts go back into stock and the invoice is marked cancelled. It keeps its number and can’t be
              reopened.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. billed to the wrong customer"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep invoice
            </Button>
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={confirm}>
              {pending ? "Cancelling…" : "Cancel invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
