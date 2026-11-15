"use client";

import { useEffect, useState } from "react";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { Button } from "@/components/ui/button";
import {
  clampLabelCount,
  DEFAULT_LABEL_SIZE,
  isLabelSize,
  LABEL_SIZES,
  labelProblem,
  QUIET_ZONE_MM,
  type LabelSize,
} from "@/lib/labels";
import type { LabelPart } from "@/server/services/labels";

export type LabelItem = LabelPart & { svg: string | null; modules: number | null };

const SIZE_KEY = "label-size";

const PROBLEM_TEXT = {
  "too-long": "SKU too long for this label; it may not scan",
  unencodable: "Can't make a barcode for this SKU",
} as const;

/**
 * SKU labels for a label-roll printer: one label per printed page at the chosen size. Counts and
 * size are local state, so switching the size keeps the edited counts; the size is remembered in
 * this browser for next time.
 */
export function LabelSheet({ items, backHref, backLabel }: { items: LabelItem[]; backHref: string; backLabel: string }) {
  const [size, setSize] = useState<LabelSize>(DEFAULT_LABEL_SIZE);
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.partId, String(i.defaultCount)])),
  );

  // Read after mount so the server render and the first client render agree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIZE_KEY);
      if (isLabelSize(saved)) setSize(saved);
    } catch {
      // Storage blocked: the default size is fine.
    }
  }, []);

  function chooseSize(next: LabelSize) {
    setSize(next);
    try {
      localStorage.setItem(SIZE_KEY, next);
    } catch {
      // Not remembered; still used for this print.
    }
  }

  const { width, height } = LABEL_SIZES[size];
  const small = width < 45;
  // No SVG means the SKU can't be encoded: it gets no labels.
  const labels = items.filter((i) => i.svg).flatMap((i) => Array.from({ length: clampLabelCount(counts[i.partId] ?? "") }, () => i));

  return (
    <div className="min-h-svh bg-white text-black">
      <style>{`
@page { size: ${width}mm ${height}mm; margin: 0; }
.sku-label { width: ${width}mm; height: ${height}mm; padding: 1mm ${QUIET_ZONE_MM}mm; }
.sku-label .bars svg { display: block; width: 100%; height: 100%; }
@media print { .sku-label:not(:last-child) { break-after: page; } }
`}</style>
      <PrintToolbar backHref={backHref} backLabel={backLabel} formats={[]} autoPrint={false}>
        {(Object.keys(LABEL_SIZES) as LabelSize[]).map((s) => (
          <Button key={s} variant={s === size ? "secondary" : "ghost"} aria-pressed={s === size} onClick={() => chooseSize(s)}>
            {LABEL_SIZES[s].label}
          </Button>
        ))}
      </PrintToolbar>

      <div className="mx-auto max-w-3xl px-4 py-4 print:hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 font-medium">Part</th>
              <th className="w-28 py-2 text-right font-medium">Labels</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const problem = labelProblem(i.sku, i.modules, size);
              return (
                <tr key={i.partId} className="border-b align-top">
                  <td className="py-2">
                    <div className="font-medium">{i.sku}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.name}
                      {i.hasBarcode && " · has a factory barcode"}
                    </div>
                    {problem && <div className="mt-1 text-xs text-destructive">{PROBLEM_TEXT[problem]}</div>}
                  </td>
                  <td className="py-2 text-right">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={999}
                      aria-label={`Labels for ${i.sku}`}
                      value={counts[i.partId] ?? ""}
                      onChange={(e) => setCounts((c) => ({ ...c, [i.partId]: e.target.value }))}
                      className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-right tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-muted-foreground">
          {labels.length === 0 ? "No labels to print." : `${labels.length} label${labels.length === 1 ? "" : "s"} to print.`}{" "}
          Set the printer&apos;s paper size to {LABEL_SIZES[size].label}.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 px-4 pb-8 print:block print:p-0">
        {labels.map((i, n) => (
          <div
            key={`${i.partId}-${n}`}
            data-label
            className="sku-label flex flex-col overflow-hidden border border-dashed border-gray-300 font-sans leading-tight print:border-0"
          >
            {/* The SVG is drawn by our own server from the SKU, never user HTML. */}
            <div className="bars min-h-0 flex-1" dangerouslySetInnerHTML={{ __html: i.svg! }} />
            <div className={`mt-0.5 text-center font-bold ${small ? "text-[8pt]" : "text-[9pt]"}`}>{i.sku}</div>
            <div className={`truncate ${small ? "text-[6pt]" : "text-[7pt]"}`}>{i.name}</div>
            {i.binLocation && <div className={small ? "text-[6pt]" : "text-[7pt]"}>Bin: {i.binLocation}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
