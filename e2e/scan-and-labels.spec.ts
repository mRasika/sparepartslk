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
