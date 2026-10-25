"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PartPicker, type PartFilterOptions, type PickedPart } from "./part-picker";

export type GridLine = { key: string; part: PickedPart } & Record<string, unknown>;

export type GridColumn<L extends GridLine> = {
  /** Field on the line this input edits. */
  field: keyof L & string;
  label: string;
  className?: string;
  inputMode?: "numeric" | "decimal" | "text";
  /** Custom cell instead of a text input. */
  render?: (line: L, update: (patch: Partial<L>) => void) => React.ReactNode;
};

/**
 * Part lines for GRNs, adjustments and invoices: a part finder on top, one row per part.
 * Picking a part that is already listed focuses its row instead of adding a duplicate.
 * Enter in a row's input returns focus to the finder.
 */
export function LineItemsGrid<L extends GridLine>({
  lines,
  onChange,
  newLine,
  columns,
  lineTotal,
  footer,
  pickerMeta,
  pickerCustomerId,
  pickerFilters,
  pickerInputRef,
  rowError,
  emptyText = "No parts added yet. Find a part above to add it.",
}: {
  lines: L[];
  onChange: (lines: L[]) => void;
  newLine: (part: PickedPart) => L;
  columns: GridColumn<L>[];
  lineTotal?: (line: L) => React.ReactNode;
  footer?: React.ReactNode;
  pickerMeta?: (part: PickedPart) => React.ReactNode;
  /** Price the finder's results for this customer. */
  pickerCustomerId?: string;
  pickerFilters?: PartFilterOptions;
  pickerInputRef?: React.RefObject<HTMLInputElement | null>;
  rowError?: (line: L) => string | undefined;
  emptyText?: string;
}) {
  const ownPickerRef = useRef<HTMLInputElement>(null);
  const pickerRef = pickerInputRef ?? ownPickerRef;
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const firstField = columns.find((c) => !c.render)?.field;

  useEffect(() => {
    if (!focusKey) return;
    const el = inputs.current.get(focusKey);
    el?.focus();
    el?.select();
    setFocusKey(null);
  }, [focusKey, lines]);

  function pick(part: PickedPart) {
    const existing = lines.find((l) => l.part.id === part.id);
    if (existing) {
      setFocusKey(`${existing.key}:${firstField}`);
      return;
    }
    const line = newLine(part);
    onChange([...lines, line]);
    setFocusKey(`${line.key}:${firstField}`);
  }

  const update = (key: string, patch: Partial<L>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="grid gap-3">
      <PartPicker onPick={pick} meta={pickerMeta} customerId={pickerCustomerId} filterOptions={pickerFilters} inputRef={pickerRef} autoFocus />
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              {columns.map((c) => (
                <TableHead key={c.field} className={c.className}>
                  {c.label}
                </TableHead>
              ))}
              {lineTotal && <TableHead className="text-right">Amount</TableHead>}
              <TableHead className="w-10">
                <span className="sr-only">Remove</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length + 3} className="py-8 text-center text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
            {lines.map((line) => {
              const error = rowError?.(line);
              return (
                <TableRow key={line.key} className={cn(error && "bg-destructive/5")}>
                  <TableCell className="min-w-48 whitespace-normal">
                    <div className="font-medium">{line.part.sku}</div>
                    <div className="text-xs text-muted-foreground">{line.part.name}</div>
                    {error && (
                      <div role="alert" className="mt-1 text-xs text-destructive">
                        {error}
                      </div>
                    )}
                  </TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.field} className={c.className}>
                      {c.render ? (
                        c.render(line, (patch) => update(line.key, patch))
                      ) : (
                        <input
                          ref={(el) => {
                            const k = `${line.key}:${c.field}`;
                            if (el) inputs.current.set(k, el);
                            else inputs.current.delete(k);
                          }}
                          aria-label={`${c.label} for ${line.part.sku}`}
                          inputMode={c.inputMode ?? "decimal"}
                          value={String(line[c.field] ?? "")}
                          onChange={(e) => update(line.key, { [c.field]: e.target.value } as Partial<L>)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              pickerRef.current?.focus();
                            }
                          }}
                          className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        />
                      )}
                    </TableCell>
                  ))}
                  {lineTotal && <TableCell className="text-right tabular-nums">{lineTotal(line)}</TableCell>}
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${line.part.sku}`}
                      onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {footer && lines.length > 0 && <TableFooter>{footer}</TableFooter>}
        </Table>
      </div>
    </div>
  );
}
