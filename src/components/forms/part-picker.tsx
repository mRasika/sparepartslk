"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { PartListRow } from "@/server/services/catalog";

export type PickedPart = Pick<PartListRow, "id" | "sku" | "name" | "oemPartNo" | "qtyOnHand" | "unit"> & {
  /** Set when the search is priced for a customer. */
  price?: string;
};

/**
 * Type-to-search part finder. Arrow keys move, Enter picks; the input clears and keeps focus
 * so the next part can be scanned or typed straight away.
 */
export function PartPicker({
  onPick,
  meta,
  placeholder = "Find a part: SKU, OEM no, barcode or name",
  autoFocus,
  inputRef,
  customerId,
}: {
  /** Price the results for this customer. */
  customerId?: string;
  onPick: (part: PickedPart) => void;
  /** Extra text shown on each result, e.g. the customer's price. */
  meta?: (part: PickedPart) => React.ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedPart[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q });
      if (customerId) params.set("customerId", customerId);
      try {
        const res = await fetch(`/api/parts/search?${params}`, { signal: controller.signal });
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
  }, [query, customerId]);

  function pick(part: PickedPart) {
    onPick(part);
    setQuery("");
    setResults([]);
  }

  return (
    <Command shouldFilter={false} className="relative overflow-visible bg-transparent">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        {/* cmdk keyboard handling comes from the Command root; a plain input keeps our styling. */}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Close right away: results keep focus via onMouseDown preventDefault, and a delayed close
          // could fire after the input was refocused and hide fresh results.
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          aria-label="Find a part"
          autoFocus={autoFocus}
          className="h-10 w-full rounded-lg border border-input bg-card pr-3 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <CommandList
        className={cn(
          "absolute top-full right-0 left-0 z-30 mt-1 max-h-80 rounded-lg border bg-popover shadow-md",
          (!open || !query.trim()) && "hidden",
        )}
      >
        {!loading && <CommandEmpty>No active part matches “{query.trim()}”.</CommandEmpty>}
        {results.map((p) => (
          <CommandItem
            key={p.id}
            value={p.id}
            onSelect={() => pick(p)}
            onMouseDown={(e) => e.preventDefault()}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="font-medium">
                {p.sku} <span className="font-normal">{p.name}</span>
              </div>
              {p.oemPartNo && <div className="text-xs text-muted-foreground">OEM {p.oemPartNo}</div>}
            </div>
            <div className="shrink-0 text-right text-xs tabular-nums">
              <div className={p.qtyOnHand > 0 ? "" : "text-destructive"}>
                {p.qtyOnHand} {p.unit} on hand
              </div>
              {meta?.(p)}
            </div>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
