# Barcode Scanning and SKU Labels: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A USB scanner adds parts on the invoice, quotation, GRN and stock adjustment screens, and the shop can print Code 128 SKU labels on a label-roll printer from a part or a saved GRN.

**Architecture:**
- **Scanning:** Enter in the shared `PartPicker` does an immediate, unfiltered search and picks a unique exact SKU/barcode match as a "scan" pick. `LineItemsGrid` handles scan picks by bumping Qty and keeping focus in the finder. Pure rules live in `src/lib/scan.ts`.
- **Labels:** the server renders one SVG per part with `bwip-js` (`src/server/barcode.ts`). A print page at `/print/labels` loads parts from a new service (`src/server/services/labels.ts`). A client sheet holds the label size and counts, and repeats each SVG once per label. Size and fit rules live in `src/lib/labels.ts`.

**Tech Stack:** Next 16.4 App Router, React 19, cmdk, Drizzle 0.45 + postgres-js, zod 4, `bwip-js` (new), Vitest on real Postgres (node env, `tests/**/*.test.ts` only, so no component tests), Playwright on installed Chrome.

**Spec:** `docs/superpowers/specs/2026-11-15-barcode-scanning-labels-design.md`

## Global Constraints

- **Branch:** `feat/barcode-scan-labels` from `main`, created **after** `chore/next-16` is merged. The first commit adds the spec and this plan.
- **Exact match:** active parts whose `sku` or `barcode` equals the trimmed code, case-insensitive. **Never** OEM number. A scan picks only when there is exactly one match.
- **Exact lookup ignores the category and bike filters** (a scan must find the part whatever filter is set).
- **Qty step on a repeat scan:** empty → `"1"`, n ≥ 0 → n + 1, n < 0 → n − 1. A non-integer value is left unchanged.
- **Copy, exactly:**
  - `No part with code “<code>”` (curly quotes, matching the finder's existing empty text; plan call)
  - `SKU too long for this label; it may not scan`
  - `Can't make a barcode for this SKU`
  - `Print label` (part page), `Print labels` (GRN page)
  - `Back to part`, `Back to GRN`, `Back to invoice`, `Back to quotation`
- **Label sizes:** `50x25` (default), `40x30`, `38x25`, in mm (width × height). Quiet zone **2 mm** each side. Warn when the bar (module) width is **< 0.19 mm**.
- **Barcode content:** the SKU exactly as stored. Encodable only when it matches `/^[\x20-\x7E]+$/`.
- **Label counts:** whole numbers 0–999. Blank or invalid → 0. GRN default = received qty (summed per part, capped at 999) for parts with no factory barcode, 0 for parts with one. Part default = 1.
- **Label size is client state** on the label page, remembered in `localStorage` (key `label-size`, wrapped in try/catch), so edited counts survive a size switch. This replaces the spec's `?size=` URL parameter (plan call, same behaviour for the user).
- **`bwip-js`:** installed with an exact version (`pnpm add --save-exact bwip-js`), imported only from `src/server/barcode.ts`.
- `/print/labels` is open to both roles: signed out → `/login`. A bad or unknown id → 404.
- **Write any file with backslashes (`\x20` regexes) using the Write/Edit tool, never a shell heredoc** (heredocs drop backslashes on this machine).

## Review Focus

1. **A scan while a category or bike filter is set** must still find the part. Pinned by `scanLookupUrl` never carrying filter params (Task 1 test).
2. **Two scans in quick succession** (the second Enter arrives while the first lookup is in flight) must add both. The same part twice → Qty 2, none lost (Task 2 e2e "two quick scans").
3. **A code with stray spaces or different letter case** (`" brk-001 "`) must match `BRK-001` (Task 1 test).
4. **A GRN with the same part on two lines** must give one label row with the summed qty (Task 4 test).
5. **A typo in a label count** (blank, `-3`, `abc`, `100000`) must never print thousands of labels or crash. It clamps to 0–999 (Task 3 test).

---

### Task 1: Scan rules

**Files:**
- Create: `src/lib/scan.ts`
- Test: `tests/lib/scan.test.ts`

**Interfaces:**
- Produces:
  - `findExactMatches<T extends { sku: string; barcode?: string | null }>(rows: T[], code: string): T[]`
  - `bumpQty(qty: string): string`
  - `scanLookupUrl(code: string, customerId?: string): string` returns `/api/parts/search?q=<code>[&customerId=<id>]`

- [ ] **Step 0: Create the branch and commit the spec and plan**

```bash
git switch main && git pull && git switch -c feat/barcode-scan-labels
git add docs/superpowers/specs/2026-11-15-barcode-scanning-labels-design.md docs/superpowers/plans/2026-11-15-barcode-scanning-labels.md
git commit -m "docs: barcode scanning and SKU labels design and plan"
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("findExactMatches", () => {
  const rows = [
    { sku: "BRK-001", barcode: null, oemPartNo: "X1" },
    { sku: "BRK-0011", barcode: "8901234567890", oemPartNo: null },
    { sku: "OIL-1", barcode: "brk-001x", oemPartNo: "BRK-001" },
  ];
  it("matches SKU ignoring case and spaces", () =>
    expect(findExactMatches(rows, " brk-001 ").map((r) => r.sku)).toEqual(["BRK-001"]));
  it("matches barcode", () =>
    expect(findExactMatches(rows, "8901234567890").map((r) => r.sku)).toEqual(["BRK-0011"]));
  it("ignores OEM numbers and prefixes", () => expect(findExactMatches(rows, "X1")).toEqual([]));
  it("returns both when one SKU equals another's barcode", () =>
    expect(findExactMatches([{ sku: "A1", barcode: null }, { sku: "B2", barcode: "a1" }], "A1")).toHaveLength(2));
  it("empty code matches nothing", () => expect(findExactMatches(rows, "  ")).toEqual([]));
});

describe("bumpQty", () => {
  it.each([["", "1"], ["1", "2"], ["0", "1"], ["-2", "-3"], [" 4 ", "5"], ["1.5", "1.5"], ["abc", "abc"]])(
    "%j → %j", (from, to) => expect(bumpQty(from)).toBe(to));
});

describe("scanLookupUrl", () => {
  it("encodes the code and never carries filters", () => {
    const url = new URL(scanLookupUrl("A B&C", "cust-1"), "http://x");
    expect(url.pathname).toBe("/api/parts/search");
    expect(url.searchParams.get("q")).toBe("A B&C");
    expect(url.searchParams.get("customerId")).toBe("cust-1");
    expect(url.searchParams.has("categoryId")).toBe(false);
    expect(url.searchParams.has("vehicleModelId")).toBe(false);
  });
  it("leaves out customerId when absent", () =>
    expect(new URL(scanLookupUrl("A"), "http://x").searchParams.has("customerId")).toBe(false));
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run tests/lib/scan.test.ts`
Expected: FAIL, cannot resolve `@/lib/scan`.

- [ ] **Step 3: Implement the three functions in `src/lib/scan.ts`.** Trim the code, then compare lowercase. `bumpQty` trims, accepts only `/^-?\d+$/`, and returns any other value unchanged.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm vitest run tests/lib/scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scan.ts tests/lib/scan.test.ts
git commit -m "feat(scan): exact-match, qty step and lookup URL rules"
```

---

### Task 2: Scanning in the part finder and line grid

**Files:**
- Modify: `src/components/forms/part-picker.tsx`
- Modify: `src/components/forms/line-items-grid.tsx`
- Create: `src/lib/beep.ts`
- Test: `e2e/scan-and-labels.spec.ts` (create; the name sorts after `full-flow.spec.ts`, which creates `BRK-001` and `GRN-<year>-000001`)

**Interfaces:**
- Consumes: `findExactMatches`, `bumpQty`, `scanLookupUrl` (Task 1).
- Produces:
  - `PickedPart` gains `barcode?: string | null`.
  - `PartPicker`'s `onPick: (part: PickedPart, how: "scan" | "list") => void`. All four editors keep passing through `LineItemsGrid`, so no editor changes.
  - `playErrorBeep(): void` in `src/lib/beep.ts`: Web Audio, a short low tone, silently does nothing when audio is unavailable.

- [ ] **Step 1: Write the failing e2e tests** in `e2e/scan-and-labels.spec.ts`. Log in as admin and use `/grn/new`: new lines start at Qty `"1"` and need no customer. `fill` then an immediate `press("Enter")` mimics a scanner (Enter lands before the 150 ms debounce).

```ts
test.describe("scanning on a GRN", () => {
  test.beforeEach(async ({ page }) => { await login(page, "admin"); await page.goto("/grn/new"); });
  const finder = (page: Page) => page.getByLabel("Find a part");

  test("a scan adds the part and keeps the cursor in the finder", async ({ page }) => {
    await finder(page).fill("brk-001");
    await finder(page).press("Enter");
    await expect(page.getByLabel("Qty for BRK-001")).toHaveValue("1");
    await expect(finder(page)).toBeFocused();
    await expect(finder(page)).toHaveValue("");
  });

  test("two quick scans of the same part give Qty 2", async ({ page }) => {
    await finder(page).fill("BRK-001"); await finder(page).press("Enter");
    await finder(page).fill("BRK-001"); await finder(page).press("Enter");
    await expect(page.getByLabel("Qty for BRK-001")).toHaveValue("2");
  });

  test("an unknown code shows an error and adds nothing", async ({ page }) => {
    await finder(page).fill("NOPE-999"); await finder(page).press("Enter");
    await expect(page.getByText("No part with code “NOPE-999”")).toBeVisible();
    await expect(page.getByText("No parts added yet")).toBeVisible();
    await finder(page).fill("BRK");
    await expect(page.getByText("No part with code “NOPE-999”")).toBeHidden();
  });

  test("picking from the list still moves to Qty", async ({ page }) => {
    await finder(page).fill("BRK");
    await page.getByRole("option", { name: /BRK-001/ }).click();
    await expect(page.getByLabel("Qty for BRK-001")).toBeFocused();
  });
});
```

The second test's second scan may start while the first lookup is still in flight. The picker must not drop it (Review Focus 2).

- [ ] **Step 2: Run them and see them fail**

Run (foreground, one server; see memory): `pnpm playwright test e2e/full-flow.spec.ts e2e/scan-and-labels.spec.ts`
Expected: the scan tests FAIL (Enter does nothing or focus moves to Qty). The list test passes.

- [ ] **Step 3: Change `PartPicker`.**
  - Control cmdk's highlighted item (`Command` `value` / `onValueChange`).
  - In the input's `onKeyDown`, for Enter with a non-blank query: `preventDefault()` and `stopPropagation()` so cmdk's root handler doesn't also select. Snapshot the query, the highlighted row and the current results, clear any scan error, then `fetch(scanLookupUrl(code, customerId))`.
    - `findExactMatches` gives 1 → `onPick(row, "scan")`.
    - It gives 2+ → show those rows as the open list.
    - It gives 0 → if the snapshot had a highlighted row, `onPick(it, "list")`. Otherwise set the error, select the input text and `playErrorBeep()`.
  - Each Enter's lookup is independent, so a second scan during the first's fetch still runs, and both picks go through `onPick`.
  - After a scan pick, clear the query and only that part's results (the existing `pick` behaviour). Focus is never moved away.
  - The error renders under the input as `<p role="alert" className="text-xs text-destructive">`. Any input change clears it.
  - Mouse/arrow selection calls `onPick(part, "list")`.

- [ ] **Step 4: Change `LineItemsGrid.pick(part, how)`.**
  - `how === "list"`: today's behaviour, unchanged.
  - `how === "scan"`, part already on a line: set its `firstField` to `bumpQty(...)`.
  - `how === "scan"`, new part: append `newLine(part)`. If that line's `firstField` is empty, focus it (today's `setFocusKey`). Otherwise leave focus in the finder.
  - Either scan case flashes the row for about 600 ms (`flashKey` state, `bg-primary/10` with a transition).
  - Build each new `lines` array from a ref that always holds the latest lines, updated as soon as `onChange` is called, not from the render-time `lines` prop. Otherwise two quick scans both start from the same old list and one is lost.

- [ ] **Step 5: Run the e2e tests, then the whole check**

Run: `pnpm playwright test e2e/full-flow.spec.ts e2e/scan-and-labels.spec.ts`
Expected: all PASS.
Run: `pnpm typecheck && pnpm lint && pnpm vitest run tests/lib`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/forms/part-picker.tsx src/components/forms/line-items-grid.tsx src/lib/beep.ts e2e/scan-and-labels.spec.ts
git commit -m "feat(scan): Enter picks a unique exact SKU/barcode match and keeps scanning"
```

---

### Task 3: Barcode rendering and label fit rules

**Files:**
- Create: `src/server/barcode.ts`, `src/lib/labels.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (`bwip-js`, exact version)
- Test: `tests/lib/barcode.test.ts`, `tests/lib/labels.test.ts`

**Interfaces:**
- Produces:
  - `src/server/barcode.ts`: `renderSkuBarcode(sku: string): { svg: string; modules: number } | null`. Returns `null` when the SKU isn't encodable. `svg` is a bars-only Code 128 SVG (no human-readable text, no padding) whose root `<svg>` has `preserveAspectRatio="none"`, so CSS can size it. `modules` = barcode width in modules.
  - `src/lib/labels.ts`:
    - `type LabelSize = "50x25" | "40x30" | "38x25"`; `LABEL_SIZES: Record<LabelSize, { width: number; height: number; label: string }>` (labels `"50 × 25 mm"` etc.); `DEFAULT_LABEL_SIZE: LabelSize = "50x25"`
    - `isLabelSize(v: unknown): v is LabelSize`
    - `isEncodableSku(sku: string): boolean`
    - `barWidthMm(modules: number, size: LabelSize): number` = (width − 4) / modules
    - `labelProblem(sku: string, modules: number | null, size: LabelSize): "unencodable" | "too-long" | null`
    - `clampLabelCount(v: string | number): number`

- [ ] **Step 1: Install `bwip-js`:** `pnpm add --save-exact bwip-js`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/lib/barcode.test.ts
it("renders a 10-character SKU as Code 128 of 145 modules", () => {
  const r = renderSkuBarcode("BRK-PAD-FZ")!;   // start 11 + 10×11 + check 11 + stop 13
  expect(r.modules).toBe(145);
  expect(r.svg).toMatch(/^<svg[^>]*preserveAspectRatio="none"/);
  expect(r.svg).not.toMatch(/<text/);
});
it("is the same every time", () => expect(renderSkuBarcode("A-1")).toEqual(renderSkuBarcode("A-1")));
it("returns null for a SKU with non-ASCII letters", () => expect(renderSkuBarcode("බ්රේක්-1")).toBeNull());

// tests/lib/labels.test.ts
it("bar width on 50 mm for 145 modules", () => expect(barWidthMm(145, "50x25")).toBeCloseTo(46 / 145));
it("13 characters fit 50 mm", () => expect(labelProblem("ABCDEFGHIJKLM", 35 + 11 * 13, "50x25")).toBeNull());
it("too long when the bar is under 0.19 mm", () => expect(labelProblem("X".repeat(20), 35 + 11 * 20, "38x25")).toBe("too-long"));
it("unencodable wins", () => expect(labelProblem("බ", null, "50x25")).toBe("unencodable"));
it.each([["", 0], ["-3", 0], ["abc", 0], ["2.7", 0], ["7", 7], [100000, 999], [12, 12]])(
  "clampLabelCount(%j) = %j", (v, n) => expect(clampLabelCount(v)).toBe(n));
it("knows the sizes", () => {
  expect(isLabelSize("40x30")).toBe(true); expect(isLabelSize("60x40")).toBe(false);
  expect(LABEL_SIZES["50x25"]).toMatchObject({ width: 50, height: 25 });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm vitest run tests/lib/barcode.test.ts tests/lib/labels.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement.**
  - `renderSkuBarcode`: check `isEncodableSku` first, then call bwip-js `toSVG({ bcid: "code128", text: sku, scale: 1, height: 10, includetext: false })`.
  - Read `modules` from the SVG's `viewBox` width. If bwip-js adds padding or uses a scale factor, account for it so the 145 test holds, and add a comment explaining how.
  - Set `preserveAspectRatio="none"` on the root.
  - `clampLabelCount` accepts only non-negative integers (`/^\d+$/` for strings) and caps them at 999.

- [ ] **Step 5: Run them and see them pass**

Run: `pnpm vitest run tests/lib/barcode.test.ts tests/lib/labels.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/server/barcode.ts src/lib/labels.ts tests/lib/barcode.test.ts tests/lib/labels.test.ts
git commit -m "feat(labels): Code 128 SVG rendering and label fit rules"
```

---

### Task 4: Label print page and buttons

**Files:**
- Create: `src/server/services/labels.ts`, `src/app/print/labels/page.tsx`, `src/components/print/label-sheet.tsx`
- Modify: `src/components/print/print-toolbar.tsx` (add a required `backLabel: string` and an optional `children` slot before Print; render `formats` only when non-empty)
- Modify: `src/app/print/invoice/[id]/page.tsx`, `src/app/print/quotation/[id]/page.tsx` (pass `backLabel`)
- Modify: `src/app/(app)/parts/[id]/page.tsx`, `src/app/(app)/grn/[id]/page.tsx` (buttons)
- Test: `tests/services/labels.test.ts`, `e2e/scan-and-labels.spec.ts` (extend)

**Interfaces:**
- Consumes: `renderSkuBarcode` (Task 3); `clampLabelCount`, `labelProblem`, `LABEL_SIZES`, `DEFAULT_LABEL_SIZE`, `isLabelSize` (Task 3).
- Produces:
  - `type LabelPart = { partId: string; sku: string; name: string; binLocation: string | null; hasBarcode: boolean; defaultCount: number }`
  - `getLabelParts(user: SessionUser, source: { partId: string } | { grnId: string }): Promise<LabelPart[]>`. Throws `NotFound` for a malformed or unknown id. GRN rows are one per part, in first-line order.
  - `LabelSheet` (client) props: `{ items: (LabelPart & { svg: string | null; modules: number | null })[]; backHref: string; backLabel: string }`

- [ ] **Step 1: Write the failing service tests** (`resetDb`, `makePart`, `makeSupplier`, `createGrn`, `factoryAdmin`; see `tests/services/grn.test.ts` for the GRN input shape):

```ts
it("GRN: received qty for parts without a barcode, 0 for parts with one", async () => {
  const a = await makePart({ sku: "A-1" }); const b = await makePart({ sku: "B-1", barcode: "8901" });
  const grn = await createGrn(admin, { supplierId, lines: [{ partId: a.id, qty: 5, unitCost: "10" }, { partId: b.id, qty: 3, unitCost: "10" }] });
  expect(await getLabelParts(admin, { grnId: grn.id })).toMatchObject([
    { sku: "A-1", hasBarcode: false, defaultCount: 5 }, { sku: "B-1", hasBarcode: true, defaultCount: 0 }]);
});
it("GRN: the same part on two lines gives one row with the summed qty", /* lines A-1 ×2 and ×4 → one row, defaultCount 6 */);
it("GRN: a received qty above 999 defaults to 999", /* qty 1500 → 999 */);
it("part: one row, default 1", /* getLabelParts(admin, { partId }) → [{ sku, defaultCount: 1 }] */);
it("unknown or malformed ids are NotFound", async () => {
  await expect(getLabelParts(admin, { partId: "nope" })).rejects.toBeInstanceOf(NotFound);
  await expect(getLabelParts(admin, { grnId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFound);
});
```

If `createGrn` refuses a duplicate part line, insert the second `grn_items` row directly in the test.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run tests/services/labels.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `getLabelParts`** in `src/server/services/labels.ts`. Validate the UUID with zod like `getGrn`. Sum qty per part, ordered by the smallest `line_no`. `defaultCount` = `hasBarcode ? 0 : clampLabelCount(sum)` for a GRN, 1 for a part.

- [ ] **Step 4: Run the service tests and see them pass**

Run: `pnpm vitest run tests/services/labels.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the e2e tests** to `e2e/scan-and-labels.spec.ts`. In `full-flow`, GRN-`<year>`-000001 receives 10 of BRK-001, which has no barcode.

```ts
test("GRN labels default to the received qty", async ({ page }) => {
  await login(page, "admin");
  await page.goto(`/grn?q=GRN-${new Date().getFullYear()}-000001`);
  await page.getByRole("link", { name: `GRN-${new Date().getFullYear()}-000001` }).click();
  await page.getByRole("link", { name: "Print labels" }).click();
  await expect(page).toHaveURL(/\/print\/labels\?grn=/);
  await expect(page.getByLabel("Labels for BRK-001")).toHaveValue("10");
  await expect(page.locator("[data-label]")).toHaveCount(10);
  await page.getByLabel("Labels for BRK-001").fill("2");
  await page.getByRole("button", { name: "40 × 30 mm" }).click();
  await expect(page.locator("[data-label]")).toHaveCount(2);
  await expect(page.getByLabel("Labels for BRK-001")).toHaveValue("2");
});
test("part page prints one label", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/parts?q=BRK-001");
  await page.getByRole("link", { name: "BRK-001" }).click();
  await page.getByRole("link", { name: "Print label" }).click();
  await expect(page.locator("[data-label]")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Back to part" })).toBeVisible();
});
```
- [ ] **Step 6: Build the page and the sheet.**
  - **Page** (server): `getSessionUser` (redirect to `/login` when signed out) → `getLabelParts` from `?part=` / `?grn=` (neither → 404, `NotFound` → `notFound()`) → `renderSkuBarcode(sku)` per item → `<LabelSheet>`. Metadata title `"Labels"`.
  - **Sheet** (client):
    - `PrintToolbar` with `formats={[]}`, with the size buttons as children (labels from `LABEL_SIZES`, `aria-pressed` on the active one).
    - A `print:hidden` table: SKU, name, a numeric input `aria-label="Labels for <SKU>"` (value through `clampLabelCount`), and the `labelProblem` text from the Global Constraints copy.
    - The labels: each `<div data-label>` is `width × height` mm, `overflow: hidden`, `break-after: page`. It holds the SVG at full width minus 2 mm each side (`dangerouslySetInnerHTML`; the SVG comes from our own server), the SKU in bold, the name on one line with ellipsis, and `Bin: <bin>` when set.
    - Unencodable items get no labels.
    - An inline `<style>` with `@page { size: <w>mm <h>mm; margin: 0 }` for the current size, following `invoice-thermal.tsx`.
    - On screen, labels show as a wrapped preview with a border; in print, borders and gaps are removed.
  - **Buttons:** "Print label" on the part page (in `PageHeader` `actions`, for every role, next to Edit) → `/print/labels?part=<id>`. "Print labels" on the GRN page `PageHeader` → `/print/labels?grn=<id>`. Both use the `buttonVariants({ variant: "outline" })` link with the `Printer` icon.

- [ ] **Step 7: Run everything**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.
Run (foreground): `pnpm playwright test e2e/full-flow.spec.ts e2e/scan-and-labels.spec.ts`, then the full `pnpm test:e2e`
Expected: all PASS, including the invoice print tests (`Back to invoice` still shows).

- [ ] **Step 8: Check a real print preview.** Run the dev server, open a GRN's labels, open Chrome's print preview at 50 × 25 mm: one label per page, bars clear of the edges, nothing cut off. Repeat at 38 × 25.

- [ ] **Step 9: Commit**

```bash
git add src/server/services/labels.ts src/app/print/labels src/components/print/label-sheet.tsx src/components/print/print-toolbar.tsx src/app/print/invoice src/app/print/quotation "src/app/(app)/parts/[id]/page.tsx" "src/app/(app)/grn/[id]/page.tsx" tests/services/labels.test.ts e2e/scan-and-labels.spec.ts
git commit -m "feat(labels): SKU label print page from a part or a GRN"
```
