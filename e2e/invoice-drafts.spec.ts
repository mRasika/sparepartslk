import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow.spec.ts (files run in name order), which creates BRK-001 with stock.
test("an unfinished invoice is kept as a draft and can be continued", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "staff");

  await page.goto("/invoices/new");
  await page.getByLabel("Find a part").fill("BRK-001");
  await page.getByRole("option", { name: /BRK-001/ }).click();
  await page.getByLabel("Qty for BRK-001").fill("2");
  await expect(page.getByText(/Draft kept/)).toBeVisible();
  await expect(page).toHaveURL(/\/invoices\/new\?draft=/);

  // Walk away and come back: the draft is listed and reopens with its lines.
  await page.goto("/dashboard");
  await page.goto("/invoices/new");
  const drafts = page.getByRole("region", { name: /Unfinished invoices/ });
  await expect(drafts.getByText("Walk-in Customer")).toBeVisible();
  await drafts.getByRole("link", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Continue invoice" })).toBeVisible();
  await expect(page.getByLabel("Qty for BRK-001")).toHaveValue("2");

  // Issuing it removes the draft.
  await page.getByRole("button", { name: "Save invoice" }).click();
  await expect(page.getByRole("heading", { name: /INV-/ })).toBeVisible();
  await page.goto("/invoices/new");
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Unfinished invoices/ })).toHaveCount(0);
});
