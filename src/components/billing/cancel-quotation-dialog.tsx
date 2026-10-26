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
import { cancelQuotationAction } from "@/server/actions/quotations";

/** Cancels an open or expired quotation with a reason. The number is kept. Any signed-in user. */
export function CancelQuotationDialog({ quotationId, number }: { quotationId: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelQuotationAction(quotationId, reason);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`${number} cancelled.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Ban /> Cancel
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {number}?</DialogTitle>
            <DialogDescription>The number is kept and it can’t be converted.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-quotation-reason">Reason</Label>
            <Textarea
              id="cancel-quotation-reason"
              rows={2}
              autoFocus
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. customer went elsewhere"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep quotation
            </Button>
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={confirm}>
              {pending ? "Cancelling…" : "Cancel quotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
