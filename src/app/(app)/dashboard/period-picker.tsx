"use client";

import { CalendarDays, CalendarRange, Check, ChevronDown } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { earliestCustomFrom } from "@/lib/periods";
import { cn } from "@/lib/utils";

type Preset = { label: string; dates: string; href: string; active: boolean };
type Custom = { active: boolean; label: string; from: string; to: string };

/**
 * One period button: a short list drops down under it on a computer and comes up from the
 * bottom on a phone (the same list in both). The period lives in the URL.
 */
export function PeriodPicker({
  presets,
  custom,
  today,
  keep,
}: {
  presets: Preset[];
  /** The current range when it is custom; also the form's starting dates. */
  custom: Custom;
  today: string;
  /** Query params the custom form carries over (top-sellers tab and sort). */
  keep: Record<string, string>;
}) {
  // Separate states: a shared one would also open the hidden phone sheet (and its backdrop).
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const current = custom.active ? "Custom dates" : (presets.find((p) => p.active)?.label ?? "Period");
  const trigger = (
    <>
      <CalendarDays aria-hidden />
      {current}
      <ChevronDown aria-hidden className="text-muted-foreground" />
    </>
  );
  const triggerClass = buttonVariants({ variant: "outline" });
  const list = (
    <PeriodList
      presets={presets}
      custom={custom}
      today={today}
      keep={keep}
      onPick={() => {
        setMenuOpen(false);
        setSheetOpen(false);
      }}
    />
  );

  // Two triggers, one shown per screen size, so the right kind of list opens without measuring.
  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger aria-label={`Period: ${current}`} className={cn(triggerClass, "max-sm:hidden")}>
          {trigger}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 gap-0 p-1.5">
          {list}
        </PopoverContent>
      </Popover>
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogTrigger aria-label={`Period: ${current}`} className={cn(triggerClass, "sm:hidden")}>
          {trigger}
        </DialogTrigger>
        <DialogContent className="top-auto bottom-0 left-0 max-h-[90dvh] max-w-none translate-x-0 translate-y-0 gap-3 overflow-y-auto rounded-t-2xl rounded-b-none px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:hidden">
          <DialogTitle>Show sales for</DialogTitle>
          {list}
        </DialogContent>
      </Dialog>
    </>
  );
}

const ROW = "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted";

function PeriodList({
  presets,
  custom,
  today,
  keep,
  onPick,
}: {
  presets: Preset[];
  custom: Custom;
  today: string;
  keep: Record<string, string>;
  onPick: () => void;
}) {
  const [showForm, setShowForm] = useState(custom.active);
  const [from, setFrom] = useState(custom.from);

  return (
    <nav aria-label="Period" className="grid gap-0.5 text-sm">
      {presets.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          scroll={false}
          aria-current={p.active ? "page" : undefined}
          className={ROW}
          onClick={onPick}
        >
          <RowIcon active={p.active} />
          <RowText title={p.label} sub={p.dates} />
        </Link>
      ))}
      <div role="separator" className="mx-1 my-1 h-px bg-border" />
      <button type="button" aria-expanded={showForm} className={ROW} onClick={() => setShowForm((s) => !s)}>
        <RowIcon active={custom.active} icon={<CalendarRange />} />
        <RowText title="Choose dates" sub={custom.active ? `Shown now: ${custom.label}` : "From one day to another"} />
      </button>
      {showForm && (
        <Form action="/dashboard" scroll={false} onSubmit={onPick} className="grid grid-cols-2 gap-3 px-2.5 pt-1 pb-2">
          {Object.entries(keep).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="grid gap-1.5">
            <Label htmlFor="period-from">From</Label>
            <Input
              id="period-from"
              type="date"
              name="from"
              required
              min={earliestCustomFrom(today)}
              max={today}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="period-to">To</Label>
            <Input id="period-to" type="date" name="to" required min={from || undefined} max={today} defaultValue={custom.to} />
          </div>
          <Button type="submit" className="col-span-2">
            Show these dates
          </Button>
        </Form>
      )}
    </nav>
  );
}

function RowIcon({ active, icon = <CalendarDays /> }: { active: boolean; icon?: React.ReactNode }) {
  return (
    <span aria-hidden className={cn("shrink-0 [&_svg]:size-4", active ? "text-primary" : "text-muted-foreground")}>
      {active ? <Check /> : icon}
    </span>
  );
}

function RowText({ title, sub }: { title: string; sub: string }) {
  return (
    <span className="grid min-w-0">
      <span className="font-medium">{title}</span>
      <span className="truncate text-xs text-muted-foreground">{sub}</span>
    </span>
  );
}
