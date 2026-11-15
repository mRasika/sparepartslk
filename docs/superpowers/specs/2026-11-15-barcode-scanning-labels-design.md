# Barcode scanning and SKU labels: design

Date: 2026-11-15. Status: draft for approval.

## Why

Staff should add parts to invoices, quotations, GRNs and stock adjustments by scanning them with a
USB barcode scanner instead of typing and searching. Scanning is faster at the counter and never
mixes up similar part numbers (e.g. `13101-KWB` vs `13101-KWC`). Most spare parts have no factory
barcode (production has 32 parts, none with a barcode, on 2026-11-15), so the shop prints its own
labels carrying the part's SKU.

This is steps 1–2 of the barcode idea. Step 3 (phone camera button) and step 4 (stock count by
phone) come later and are not part of this work.

## Goals

1. **Scan-ready part finder.** A USB scanner (types the code, then Enter) works on all four screens
   that use `PartPicker` + `LineItemsGrid`: new invoice, quotation, GRN, stock adjustment.
2. **SKU labels.** Print Code 128 labels of the SKU on a thermal label printer (sticker roll), from a
   part's page and from a saved GRN.

## Non-goals

- Phone camera scanning, stock count mode (steps 3–4).
- More than one barcode per part. The existing single `parts.barcode` field stays as is.
- A4 sticker sheets or receipt-paper labels. Only the label-roll printer is supported.
- Printer languages (ZPL/TSPL) or direct printer drivers. Printing goes through the browser.
- Prices or the shop name on labels (customers pay different prices by tier).
- Labels from an unsaved GRN form.

## Anti-goals (a failure even if it works)

- A scan that adds the **wrong** part. A scan picks a part only on a unique exact match, never a guess.
- Breaking how staff type and search today. Typing, arrow keys and mouse picking behave as now.

## Approaches considered

**Drawing the barcode**
- **A. `bwip-js` (chosen).** Mature, pure-JS, no dependencies; renders Code 128 as SVG on the
  server. Proven encoding. Largish package, server only.
- B. Own Code 128 encoder (~100 lines). No new package, but a single typo in the 107-row pattern
  table gives labels that don't scan, found only at the counter.

**Printing**
- **A. Browser print page (chosen),** like the invoice A4/Receipt pages: same toolbar, a label size
  switch. Matches how staff already print.
- B. PDF via `@react-pdf/renderer`. Slightly more exact sizing, but an extra download-then-print step.

## Design

### Step 1: scan-ready finder (`part-picker.tsx`, `line-items-grid.tsx`)

**Enter in the finder** (input not empty):
1. Cancel the pending debounce and search **now** with the same query and filters (customer price
   included), unless the current results already belong to this exact query.
2. **Exact match** = active parts whose SKU or barcode equals the query, ignoring case. OEM numbers
   are left out (not unique). The search API already returns `barcode` and ranks exact matches first;
   the check happens in the client, no new endpoint.
3. Exactly one exact match → **scan pick** (below). Input clears, focus stays in the finder.
4. No exact match → today's behaviour: if the list has a highlighted result, Enter picks it as now
   (normal pick). If there are no results, show the error.
5. Two exact matches (one part's SKU equals another's barcode) → no pick; the list opens so the user
   chooses.

The Enter handler must run before cmdk's own Enter handling on the `Command` root.

**Unknown code error:** red text under the finder, `No part with code "X"`, plus a short error beep
(Web Audio, no sound file). The text stays in the input, selected, so the next scan replaces it.
The error clears when the input changes. No sound on success (the scanner beeps itself).

**Scan pick in the grid** (`onPick` gets a second argument telling a scan pick from a normal pick):
- Part already on a line → change that line's first field (Qty) by one: empty → `1`,
  n ≥ 0 → n + 1, n < 0 → n − 1 (a negative stock adjustment moves one further from zero).
  Focus stays in the finder.
- New part → add the line with the editor's usual `newLine`. If its Qty is filled (`"1"` on invoice,
  quotation, GRN and write-off adjustments), focus stays in the finder. If Qty starts empty (signed
  "Change" adjustment), focus goes to Qty as today, because a value is required.
- The changed or added row flashes briefly so staff can see which line moved.

**Normal pick** (mouse or arrow keys + Enter on a non-exact result) is unchanged: focus goes to Qty
on a new line, or jumps to the existing line.

Existing row checks stay as they are (e.g. invoice qty above stock shows the row error).

### Step 2: SKU labels

**Dependency:** `bwip-js`, imported only in server code. Each part's barcode is rendered once on the
server as an SVG string (Code 128, content = the SKU exactly as stored, text drawn by us, not by
bwip-js).

**Route:** `/print/labels` under `src/app/print/`, signed-in users only (same pattern as
`/print/invoice/[id]`; both roles may print).
- `?part=<id>` → one part, default count 1.
- `?grn=<id>` → every GRN line. Default count = qty received for parts **without** a factory
  barcode, 0 for parts that have one.
- `?size=50x25` (default), `40x30` or `38x25`, switched from the toolbar like the invoice formats.

**Page:**
- The existing `PrintToolbar` (back link to the part or GRN, size switch, Print button).
- A screen-only table: SKU, name, label count (editable number, 0 skips the part), and a warning
  when the SKU is too long for the chosen label (below). Hidden when printing.
- The labels: one label per printed page, `@page { size: <w>mm <h>mm; margin: 0 }`, each label
  `break-after: page`. The server sends one SVG per part; the client repeats it by count, so changing
  a count needs no reload.

**Label layout** (50×25 mm; smaller sizes shrink text, keep the bar height as large as fits):

```
┌──────────────────────────────┐
│ ▌▌█▐▌█▐█▌▐▌█▌▐█▐▌▌█▐▌▐█▌▐▌█ │  barcode, quiet zone ≥ 2 mm each side
│        BRK-PAD-FZ            │  SKU, bold
│ Brake pad set - FZ front     │  name, one line, cut with …
│ Bin: A-12                    │  only when the part has a bin location
└──────────────────────────────┘
```

**Too-long warning:** Code 128 width is about 35 + 11 × characters (modules; fewer with long digit
runs). If fitting it in the label width (minus quiet zones) needs a bar narrower than 0.19 mm, the
row shows "SKU too long for this label; it may not scan". Printing is still allowed. On a 203 dpi
printer a 50 mm label fits about 13 characters at 0.25 mm bars; production's longest SKU is 13.

**Buttons:** "Print label" on the part page (`/parts/[id]`), "Print labels" on the GRN page
(`/grn/[id]`). Both open the label page in the same tab, like invoice printing.

Non-ASCII SKUs can't be encoded in Code 128 B: the row shows "Can't make a barcode for this SKU"
and prints no label for it (none exist in production today).

## Testing

- Unit: exact-match selection (one, none, two matches; case), the qty step rule (empty, positive,
  negative), the too-long width check.
- E2E (Playwright): type a code fast + Enter before results load → line added, focus still in the
  finder; second scan → Qty 2; unknown code → error shown, nothing added; normal search + mouse pick
  unchanged; label page for a GRN shows the right default counts and the right number of labels.
- By the owner: a real USB scanner on each screen, and a real label printer with the paper size set
  in the printer driver (a test print of each size).

## Left to the builder

- Component and function names, file layout inside the existing folders.
- The beep's sound, and the flash's look and length.
- Exact font sizes per label size.
- Branch: start from `main` after the Next 16 upgrade (`chore/next-16`) is merged.
