"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionError } from "@/lib/action-result";
import { formatDate, formatMoney } from "@/lib/format";
import { saveSalesTargetAction } from "@/server/actions/sales-targets";
import type { TargetSettings } from "@/server/services/sales-targets";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const closedNames = (days: number[]) => (days.length ? days.map((d) => WEEKDAYS[d - 1]).join(", ") : "none");

/** The daily net-sales target; a save applies from today on (spec §4). */
export function SalesTargetForm({ current, previous }: Pick<TargetSettings, "current" | "previous">) {
  const router = useRouter();
  const [dailyTarget, setDailyTarget] = useState(current?.dailyTarget ?? "");
  const [closed, setClosed] = useState<number[]>(current?.closedWeekdays ?? []);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveSalesTargetAction({ dailyTarget, closedWeekdays: closed });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error.message);
        return;
      }
      toast.success("Sales target saved");
      router.refresh();
    });
  }

  const toggle = (day: number, on: boolean) =>
    setClosed((s) => (on ? [...s, day].sort() : s.filter((d) => d !== day)));

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="dailyTarget">Daily target (Rs)</Label>
        <Input
          id="dailyTarget"
          inputMode="decimal"
          required
          value={dailyTarget}
          onChange={(e) => setDailyTarget(e.target.value)}
        />
        {error?.field === "dailyTarget" ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Net sales: excluding VAT, after returns.</p>
        )}
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Closed weekdays</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {WEEKDAYS.map((name, i) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <Checkbox checked={closed.includes(i + 1)} onCheckedChange={(c) => toggle(i + 1, Boolean(c))} />
              {name}
            </label>
          ))}
        </div>
        {error?.field === "closedWeekdays" && <p className="text-sm text-destructive">{error.message}</p>}
      </fieldset>
      {error && !error.field && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save target"}
        </Button>
        <p className="text-sm text-muted-foreground">
          {current ? (
            <>
              In force since {formatDate(current.effectiveFrom)}
              {previous &&
                `. Before: Rs ${formatMoney(previous.dailyTarget)}, closed ${closedNames(previous.closedWeekdays)}`}
            </>
          ) : (
            "No daily target yet."
          )}
        </p>
      </div>
    </form>
  );
}
