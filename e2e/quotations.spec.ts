import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow and invoice-drafts (files run in name order): BRK-001 has 3 in stock.
test("a quotation is printed, converted and linked to its invoice", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "admin");

  await page.goto("/quotations/new");
  await page.getByLabel("Find a part").fill("BRK-001");
  await page.getByRole("option", { name: /BRK-001/ }).click();
  await page.getByLabel("Qty for BRK-001").fill("3");
  await expect(page.getByText("3,000.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Save quotation" }).click();
  await expect(page.getByRole("heading", { name: /QUO-\d{4}-\d{6}/ })).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Print A4" }).click();
  await expect(page.getByText("QUOTATION", { exact: true })).toBeVisible();
  await expect(page.getByText(/Subject to stock availability/)).toBeVisible();
  await page.goBack();

  // The editor opens with the quotation's lines; payment is still the cashier's choice.
  await page.getByRole("link", { name: "Convert to invoice" }).click();
  await expect(page.getByText(/From quotation QUO-/)).toBeVisible();
  await expect(page.getByLabel("Qty for BRK-001")).toHaveValue("3");
  await page.getByLabel("Qty for BRK-001").fill("1");
  await page.getByRole("radio", { name: "Cash" }).click();
  await page.getByLabel("Cash received (Rs)").fill("5000");
  await page.getByRole("button", { name: "Save invoice" }).click();

  await expect(page.getByRole("heading", { name: /INV-/ })).toBeVisible();
  await expect(page.getByText(/From quotation QUO-/)).toBeVisible();
  await page.getByRole("link", { name: /QUO-/ }).click();
  await expect(page.getByText(/Converted → INV-/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Convert to invoice" })).toHaveCount(0);
});
