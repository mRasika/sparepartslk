import { expect, test, type Page } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow.spec.ts (files run in name order), which creates part BRK-001 (no factory
// barcode) and GRN-<year>-000001 receiving 10 of it.

// `fill` then an immediate Enter is what a USB scanner does: the code and Enter arrive well inside
// the finder's 150 ms search delay.
const finder = (page: Page) => page.getByLabel("Find a part");

async function scan(page: Page, code: string) {
  await finder(page).fill(code);
  await finder(page).press("Enter");
}

test.describe("scanning on a GRN", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto("/grn/new");
  });

  test("a scan adds the part and keeps the cursor in the finder", async ({ page }) => {
    await scan(page, "brk-001");
    await expect(page.getByLabel("Qty for BRK-001")).toHaveValue("1");
    await expect(finder(page)).toBeFocused();
    await expect(finder(page)).toHaveValue("");
  });

  test("two quick scans of the same part give Qty 2", async ({ page }) => {
    await scan(page, "BRK-001");
    await scan(page, "BRK-001");
    await expect(page.getByLabel("Qty for BRK-001")).toHaveValue("2");
    await expect(page.getByLabel("Qty for BRK-001")).toHaveCount(1);
  });

  test("an unknown code shows an error and adds nothing", async ({ page }) => {
    await scan(page, "NOPE-999");
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

test.describe("SKU labels", () => {
  const grnNumber = `GRN-${new Date().getFullYear()}-000001`;

  test("GRN labels default to the received qty", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`/grn?q=${grnNumber}`);
    await page.getByRole("link", { name: grnNumber }).click();
    await page.getByRole("link", { name: "Print labels" }).click();
    await expect(page).toHaveURL(/\/print\/labels\?grn=/);
    await expect(page.getByLabel("Labels for BRK-001")).toHaveValue("10");
    await expect(page.locator("[data-label]")).toHaveCount(10);
    await page.getByLabel("Labels for BRK-001").fill("2");
    await page.getByRole("button", { name: "40 × 30 mm" }).click();
    await expect(page.locator("[data-label]")).toHaveCount(2);
    await expect(page.getByLabel("Labels for BRK-001")).toHaveValue("2");
    await expect(page.getByRole("link", { name: "Back to GRN" })).toBeVisible();
  });

  test("part page prints one label", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/parts?q=BRK-001");
    await page.getByRole("link", { name: "BRK-001" }).click();
    await page.getByRole("link", { name: "Print label" }).click();
    await expect(page.locator("[data-label]")).toHaveCount(1);
    await expect(page.locator("[data-label] svg")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Back to part" })).toBeVisible();
  });
});

// Fixes from the final review: a scan uses list results only when they belong to the exact text
// Enter was pressed on. Own part family (SCAN-…) so later specs that match "BRK-001" by name
// still find one part.
test.describe("scan edge cases", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, "admin");
    // Playwright reruns beforeAll in a fresh worker after a failure: create the data once.
    await page.goto("/parts?q=SCAN-10");
    try {
      // The list streams in after the page; give it a moment.
      await page.getByRole("link", { name: "SCAN-10", exact: true }).waitFor({ timeout: 5_000 });
      return page.close();
    } catch {
      // Not there yet: create it below.
    }
    await page.goto("/parts/settings");
    await page.getByRole("button", { name: "Add category" }).click();
    await page.getByLabel("Name").fill("Scan test");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Category saved")).toBeVisible();
    for (const [sku, name, category] of [
      ["SCAN-1", "Scan test part one", "Scan test"],
      ["SCAN-10", "Scan test part ten", ""],
    ]) {
      await page.goto("/parts/new");
      await page.getByLabel("SKU").fill(sku);
      await page.getByLabel("Name", { exact: true }).fill(name);
      if (category) await page.getByLabel("Category").selectOption({ label: category });
      await page.getByLabel("Retail price (Rs)").fill("100");
      await page.getByRole("button", { name: "Create part" }).click();
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto("/grn/new");
  });

  test("an unknown code with a category filter set adds nothing", async ({ page }) => {
    await page.getByLabel("Filter by category").selectOption({ label: "Scan test" });
    await expect(page.getByRole("option", { name: /SCAN-1/ })).toBeVisible();
    await scan(page, "NOPE-777");
    await expect(page.getByText("No part with code “NOPE-777”")).toBeVisible();
    await expect(page.getByText("No parts added yet")).toBeVisible();
  });

  test("two unknown codes in a row add nothing", async ({ page }) => {
    await scan(page, "scan test");
    await expect(page.getByText("No part with code “scan test”")).toBeVisible();
    await expect(page.getByRole("option", { name: /^SCAN-1 / })).toBeVisible(); // name matches load
    await scan(page, "NOPE-778");
    await expect(page.getByText("No part with code “NOPE-778”")).toBeVisible();
    await expect(page.getByText("No parts added yet")).toBeVisible();
  });

  test("a typed search, Enter and the quantity straight away keeps the quantity", async ({ page }) => {
    await finder(page).fill("scan test part one");
    await expect(page.getByRole("option", { name: /^SCAN-1 / })).toBeVisible();
    await finder(page).press("Enter");
    await page.keyboard.type("3");
    await expect(page.getByLabel("Qty for SCAN-1", { exact: true })).toHaveValue("3");
    await expect(finder(page)).toHaveValue("");
  });

  test("the row chosen with the arrow keys wins over an exact match", async ({ page }) => {
    await finder(page).fill("scan-1");
    await expect(page.getByRole("option", { name: /SCAN-10/ })).toBeVisible();
    await finder(page).press("ArrowDown");
    await finder(page).press("Enter");
    await expect(page.getByLabel("Qty for SCAN-10", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Qty for SCAN-1", { exact: true })).toHaveCount(0);
  });
});
