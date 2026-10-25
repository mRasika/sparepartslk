import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow.spec.ts (files run in name order), which creates BRK-001 with stock.
test("an unfinished invoice is kept as a draft and can be continued", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "admin");

  // A second part to add after the first auto-save.
  await page.goto("/parts/new");
  await page.getByLabel("SKU").fill("OIL-002");
  await page.getByLabel("Name", { exact: true }).fill("Engine Oil 1L");
  await page.getByLabel("Retail price (Rs)").fill("500");
  await page.getByRole("button", { name: "Create part" }).click();
  await expect(page.getByRole("heading", { name: "Engine Oil 1L" })).toBeVisible();

  await page.goto("/invoices/new");
  await page.getByLabel("Find a part").fill("BRK-001");
  await page.getByRole("option", { name: /BRK-001/ }).click();
  await page.getByLabel("Qty for BRK-001").fill("2");
  await expect(page.getByText(/Draft kept/)).toBeVisible();

  // Regression: a line added after the first auto-save used to vanish when the page reloaded
  // itself from the saved draft.
  await page.getByLabel("Find a part").fill("OIL-002");
  await page.getByRole("option", { name: /OIL-002/ }).click();
  await page.waitForTimeout(2500);
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await expect(page.getByLabel("Qty for BRK-001")).toHaveValue("2");
  await expect(page.getByLabel("Qty for OIL-002")).toBeVisible();
  await page.getByRole("button", { name: "Remove OIL-002" }).click(); // no stock; keep the sale valid
  await page.waitForTimeout(1000);

  // Walk away and come back: the draft is listed and reopens with its lines.
  await page.goto("/dashboard");
  await page.goto("/invoices/new");
  const drafts = page.getByRole("region", { name: /Unfinished invoices/ });
  await expect(drafts.getByText("Walk-in Customer")).toBeVisible();
  await drafts.getByRole("link", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Continue invoice" })).toBeVisible();
  await expect(page.getByLabel("Qty for BRK-001")).toHaveValue("2");
  await expect(page.getByLabel("Qty for OIL-002")).toHaveCount(0);

  // Nothing is preselected for payment: saving waits for Cash/Credit and, for cash, the money received.
  const save = page.getByRole("button", { name: "Save invoice" });
  await expect(page.getByText("Choose Cash or Credit")).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByRole("radio", { name: "Cash" }).click();
  await expect(page.getByText("Enter the cash received")).toBeVisible();
  await page.getByLabel("Cash received (Rs)").fill("1500");
  await expect(page.getByText("Cash received is Rs 500.00 short")).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel("Cash received (Rs)").fill("2500");
  await expect(page.getByText("Rs 500.00", { exact: true })).toBeVisible(); // change
  await expect(save).toBeEnabled();

  // Issuing it removes the draft.
  await save.click();
  await expect(page.getByRole("heading", { name: /INV-/ })).toBeVisible();
  await page.goto("/invoices/new");
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Unfinished invoices/ })).toHaveCount(0);
});
