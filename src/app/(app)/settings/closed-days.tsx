"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { formatDate } from "@/lib/format";
import { addClosedDayAction, removeClosedDayAction } from "@/server/actions/sales-targets";
import type { TargetSettings } from "@/server/services/sales-targets";

/** Upcoming days the shop is shut beyond its closed weekdays (Poya days, holidays). */
export function ClosedDays({ closedDays, today }: { closedDays: TargetSettings["closedDays"]; today: string }) {
  const router = useRouter();
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult<unknown>>, done: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      done();
      router.refresh();
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => addClosedDayAction({ day, reason }),
      () => {
        toast.success(`${formatDate(day)} closed`);
        setDay("");
        setReason("");
      },
    );
  }

  return (
    <div className="grid gap-3">
      <h3 className="text-sm font-medium">Closed dates</h3>
      {closedDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">No closed dates coming up.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {closedDays.map((c) => (
            <li key={c.day} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="font-medium">{formatDate(c.day)}</span>
                {c.reason && <span className="text-muted-foreground"> · {c.reason}</span>}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${formatDate(c.day)}`}
                disabled={pending}
                onClick={() => run(() => removeClosedDayAction(c.day), () => toast.success("Closed date removed"))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="closedDay">Date</Label>
          <Input id="closedDay" type="date" required min={today} value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="closedReason">Reason</Label>
          <Input
            id="closedReason"
            maxLength={100}
            placeholder="e.g. Vesak Poya"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Add closed date
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
