"use client";

import { UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchCustomersAction } from "@/server/actions/customers";
import type { CustomerRow } from "@/server/services/customers";

export type PickedCustomer = Pick<
  CustomerRow,
  "id" | "name" | "businessName" | "phone" | "tierName" | "creditLimit" | "creditDays" | "isWalkIn"
>;

/** Shows the chosen customer; typing searches active customers (name, business or phone). */
export function CustomerPicker({
  value,
  onChange,
}: {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const r = await searchCustomersAction(query);
      if (id === requestId.current) setResults(r.ok ? r.data : []);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  return (
    <div className="grid gap-1.5">
      <label htmlFor="customer-search" className="text-sm font-medium">
        Customer
      </label>
      <Command shouldFilter={false} className="relative overflow-visible bg-transparent">
        <div className="relative">
          <UserRound className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            id="customer-search"
            value={open ? query : (value?.name ?? "")}
            placeholder="Search customers"
            onFocus={(e) => {
              setOpen(true);
              setQuery("");
              e.currentTarget.select();
            }}
            onBlur={() => setOpen(false)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur(), setOpen(false))}
            className="h-10 w-full rounded-lg border border-input bg-card pr-3 pl-8 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <CommandList
          className={cn(
            "absolute top-full right-0 left-0 z-30 mt-1 max-h-72 rounded-lg border bg-popover shadow-md",
            !open && "hidden",
          )}
        >
          <CommandEmpty>No active customer matches.</CommandEmpty>
          {results.map((c) => (
            <CommandItem
              key={c.id}
              value={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onSelect={() => {
                // Blur our own input first; onChange may move focus elsewhere (e.g. the part finder).
                inputRef.current?.blur();
                setOpen(false);
                onChange(c);
              }}
              className="flex justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{[c.businessName, c.phone].filter(Boolean).join(", ")}</div>
              </div>
              <div className="shrink-0 text-right text-xs">
                <div>{c.tierName}</div>
                <div className="text-muted-foreground">
                  {c.creditLimit === "0.00" ? "Cash only" : `Credit Rs ${formatMoney(c.creditLimit)}`}
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
      {value && (
        <p className="text-xs text-muted-foreground">
          {value.tierName} prices
          {value.isWalkIn
            ? ", cash only"
            : value.creditLimit === "0.00"
              ? ", cash only (no credit limit)"
              : `, credit up to Rs ${formatMoney(value.creditLimit)} for ${value.creditDays} days`}
        </p>
      )}
    </div>
  );
}
