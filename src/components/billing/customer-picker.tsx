"use client";

import { UserRound, UserRoundPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerRow } from "@/server/services/customers";
import { prefillFrom, QuickAddCustomerDialog, type QuickAddPrefill } from "./quick-add-customer-dialog";

export type PickedCustomer = Pick<
  CustomerRow,
  "id" | "name" | "businessName" | "phone" | "tierName" | "creditLimit" | "creditDays" | "isWalkIn"
>;

/**
 * Shows the chosen customer; typing searches active customers (name, business or phone). With
 * `allowAdd`, the list ends with "Add … as a new customer", which adds and picks a cash customer.
 */
export function CustomerPicker({
  value,
  onChange,
  allowAdd = false,
}: {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer) => void;
  allowAdd?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<QuickAddPrefill | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        setResults(res.ok ? await res.json() : []);
        setLoading(false);
      } catch {
        // Aborted by a newer keystroke (which owns loading now) or a network failure.
        if (!controller.signal.aborted) {
          setResults([]);
          setLoading(false);
        }
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const typed = query.trim();
  const canAdd = allowAdd && typed !== "" && !loading;

  function pick(c: PickedCustomer) {
    // Blur our own input first; onChange may move focus elsewhere (e.g. the part finder).
    inputRef.current?.blur();
    setOpen(false);
    onChange(c);
  }

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
          {/* The search is a server round trip; don't claim "no match" before it answers. */}
          {loading && results.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
          ) : (
            !loading && <CommandEmpty>No active customer matches.</CommandEmpty>
          )}
          {/* CommandEmpty hides once the add row is there; keep saying nothing matched. */}
          {canAdd && results.length === 0 && (
            <div className="px-3 pt-3 pb-1 text-sm text-muted-foreground">No active customer matches.</div>
          )}
          {results.map((c) => (
            <CommandItem
              key={c.id}
              value={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onSelect={() => pick(c)}
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
          {canAdd && (
            <CommandItem
              value="__add__"
              onMouseDown={(e) => e.preventDefault()}
              onSelect={() => {
                inputRef.current?.blur();
                setOpen(false);
                setAdding(prefillFrom(typed));
              }}
              className="gap-2 border-t px-3 py-2 font-medium"
            >
              <UserRoundPlus className="size-4" />
              Add “{typed}” as a new customer
            </CommandItem>
          )}
        </CommandList>
      </Command>
      {allowAdd && (
        <QuickAddCustomerDialog
          prefill={adding}
          onClose={() => setAdding(null)}
          onAdded={(c) => {
            setAdding(null);
            onChange(c);
          }}
        />
      )}
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
