"use client";

import { CalendarRange } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { earliestCustomFrom } from "@/lib/periods";
import { cn } from "@/lib/utils";

/** Preset period links plus a Custom from/to popover; the period lives in the URL. */
export function PeriodPicker({
  presets,
  custom,
  today,
  keep,
}: {
  presets: { label: string; href: string; active: boolean }[];
  /** The current range when it is custom; also the popover's starting dates. */
  custom: { active: boolean; label: string; from: string; to: string };
  today: string;
  /** Query params the custom form carries over (top-sellers tab and sort). */
  keep: Record<string, string>;
}) {
  const [from, setFrom] = useState(custom.from);

  return (
    <nav aria-label="Period" className="flex flex-wrap gap-1">
      {presets.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          scroll={false}
          aria-current={p.active ? "page" : undefined}
          className={buttonVariants({ variant: p.active ? "secondary" : "ghost", size: "sm" })}
        >
          {p.label}
        </Link>
      ))}
      <Popover>
        <PopoverTrigger
          aria-label="Custom"
          className={cn(buttonVariants({ variant: custom.active ? "secondary" : "ghost", size: "sm" }))}
        >
          <CalendarRange aria-hidden />
          {custom.active ? custom.label : "Custom"}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <form action="/dashboard" method="get" className="grid gap-3">
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
            <Button type="submit" size="sm">
              Apply
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </nav>
  );
}
