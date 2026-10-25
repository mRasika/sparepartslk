import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs last (files run in name order): it changes BRK-001's prices, which earlier specs rely on.
test("admin sets a tier rule and changes prices in bulk", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "admin");

  await page.goto("/settings/tiers");
  const wholesale = page.getByRole("row").filter({ has: page.getByLabel("Name of Wholesale") });
  await wholesale.getByLabel("Percent below the base price").fill("15");
  await wholesale.getByLabel("Rounding").selectOption("10");
  await expect(wholesale.getByText("Retail −15%, nearest Rs 10")).toBeVisible();
  await wholesale.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Wholesale saved")).toBeVisible();

  await page.goto("/parts/prices");
  await page.getByLabel("Tier").selectOption({ label: "Retail" });
  await page.getByLabel("Change (%)").fill("10");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByRole("cell", { name: /BRK-001/ })).toBeVisible();
  await expect(preview.getByRole("cell", { name: "1,100.00" })).toBeVisible();
  await preview.getByRole("button", { name: /Apply to/ }).click();
  await expect(page.getByText(/prices? updated/)).toBeVisible();

  // BRK-001 had Retail 1000 and Dealer 900 typed, no Wholesale price: Wholesale now follows the rule.
  await page.goto("/parts?q=BRK-001");
  await page.getByRole("link", { name: "BRK-001" }).click();
  await expect(page.getByText("Rs 1,100.00")).toBeVisible();
  await expect(page.getByText("Rs 940.00")).toBeVisible(); // 1100 × 0.85 = 935 → nearest 10
});
