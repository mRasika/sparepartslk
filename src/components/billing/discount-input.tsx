"use client";

import { cn } from "@/lib/utils";

/** A small amount box with a %/Rs toggle. */
export function DiscountInput({
  value,
  onChange,
  label,
}: {
  value: { type: "percent" | "amount"; value: string };
  onChange: (v: { type: "percent" | "amount"; value: string }) => void;
  label: string;
}) {
  return (
    <span className="inline-flex items-center rounded-md border border-input bg-transparent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <input
        aria-label={`${label} (${value.type === "percent" ? "%" : "Rs"})`}
        inputMode="decimal"
        placeholder="0"
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        className="h-8 w-16 bg-transparent px-2 text-right text-sm tabular-nums outline-none"
      />
      <button
        type="button"
        onClick={() => onChange({ ...value, type: value.type === "percent" ? "amount" : "percent" })}
        aria-label={`Switch ${label} to ${value.type === "percent" ? "rupees" : "percent"}`}
        className={cn(
          "h-8 w-9 rounded-r-md border-l border-input text-xs font-medium text-muted-foreground hover:bg-muted",
        )}
      >
        {value.type === "percent" ? "%" : "Rs"}
      </button>
    </span>
  );
}
