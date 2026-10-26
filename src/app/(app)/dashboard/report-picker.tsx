"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Picks the day for the daily report PDF; up to today. */
export function ReportPicker({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const valid = Boolean(date) && date <= today;
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        aria-label="Report date"
        max={today}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-9 w-40"
      />
      <a
        href={`/api/reports/daily?date=${date}&download=1`}
        download
        aria-disabled={!valid || undefined}
        className={buttonVariants({ variant: "outline", className: !valid ? "pointer-events-none opacity-50" : "" })}
      >
        <Download /> Download PDF
      </a>
    </div>
  );
}
