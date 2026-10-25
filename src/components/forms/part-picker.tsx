"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { PartListRow } from "@/server/services/catalog";

export type PickedPart = Pick<PartListRow, "id" | "sku" | "name" | "oemPartNo" | "qtyOnHand" | "unit"> & {
  binLocation?: string | null;
  /** Set when the search is priced for a customer. */
  price?: string;
};

/** Lists for the finder's filters; without them the finder is search only. */
export type PartFilterOptions = {
  categories: { id: string; name: string }[];
  vehicleModels: { id: string; label: string }[];
};

/**
 * Type-to-search part finder. Arrow keys move, Enter picks; the input clears and keeps focus
 * so the next part can be scanned or typed straight away. Choosing a category or bike narrows
 * the search, and with nothing typed lists everything in it.
 */
export function PartPicker({
  onPick,
  meta,
  placeholder = "Find a part: SKU, OEM, barcode, name",
  autoFocus,
  inputRef,
  customerId,
  filterOptions,
}: {
  /** Price the results for this customer. */
  customerId?: string;
  onPick: (part: PickedPart) => void;
  /** Extra text shown on each result, e.g. the customer's price. */
  meta?: (part: PickedPart) => React.ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  filterOptions?: PartFilterOptions;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const input = inputRef ?? ownRef;
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [vehicleModelId, setVehicleModelId] = useState("");
  const [results, setResults] = useState<PickedPart[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const filtered = Boolean(categoryId || vehicleModelId);
  const active = Boolean(query.trim()) || filtered;

  useEffect(() => {
    const q = query.trim();
    if (!q && !categoryId && !vehicleModelId) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q });
      if (customerId) params.set("customerId", customerId);
      if (categoryId) params.set("categoryId", categoryId);
      if (vehicleModelId) params.set("vehicleModelId", vehicleModelId);
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
  }, [query, customerId, categoryId, vehicleModelId]);

  function pick(part: PickedPart) {
    onPick(part);
    setQuery("");
    // A filtered list stays for the next pick; a plain search starts over.
    if (!filtered) setResults([]);
  }

  /** After choosing a filter, go back to the input so the list opens and typing narrows it. */
  function changeFilter(set: (v: string) => void, value: string) {
    set(value);
    requestAnimationFrame(() => input.current?.focus());
  }

  const empty = query.trim()
    ? `No active part matches “${query.trim()}”${filtered ? " with these filters" : ""}.`
    : "No active parts here.";

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Command shouldFilter={false} className="relative flex-1 overflow-visible bg-transparent">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          {/* cmdk keyboard handling comes from the Command root; a plain input keeps our styling. */}
          <input
            ref={input}
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
            placeholder={filtered ? "Type to narrow, or pick from the list" : placeholder}
            aria-label="Find a part"
            autoFocus={autoFocus}
            className="h-10 w-full rounded-lg border border-input bg-card pr-3 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <CommandList
          className={cn(
            "absolute top-full right-0 left-0 z-30 mt-1 max-h-96 rounded-lg border bg-popover shadow-md",
            (!open || !active) && "hidden",
          )}
        >
          {loading && results.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
          ) : (
            !loading && <CommandEmpty>{empty}</CommandEmpty>
          )}
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
                <div className="text-xs text-muted-foreground">
                  {[p.oemPartNo && `OEM ${p.oemPartNo}`, p.binLocation && `Bin ${p.binLocation}`].filter(Boolean).join(" · ")}
                </div>
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
      {filterOptions && (
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <NativeSelect
            aria-label="Filter by category"
            value={categoryId}
            onChange={(e) => changeFilter(setCategoryId, e.target.value)}
            className="w-full sm:w-44"
          >
            <NativeSelectOption value="">All categories</NativeSelectOption>
            {filterOptions.categories.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Filter by bike"
            value={vehicleModelId}
            onChange={(e) => changeFilter(setVehicleModelId, e.target.value)}
            className="w-full sm:w-48"
          >
            <NativeSelectOption value="">All bikes</NativeSelectOption>
            {filterOptions.vehicleModels.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {m.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
