import { expect, test } from "@playwright/test";
import { colomboDate } from "@/lib/dates";
import { login } from "./users";

// Runs after full-flow (files run in name order), which sells BRK-001 today.
test("admin switches periods, a custom range and top-seller views", async ({ page }) => {
  const today = colomboDate();
  const newYear = `${today.slice(0, 4)}-01-01`;
  await login(page, "admin");

  await expect(page.getByRole("heading", { name: "Sales & profit" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /BRK-001/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sales and profit by day/ })).toBeVisible();

  await page.getByRole("link", { name: "Last month" }).click();
  await expect(page).toHaveURL(/period=last-month/);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  await page.getByRole("button", { name: "Custom" }).click();
  await page.getByLabel("From", { exact: true }).fill(newYear);
  await page.getByLabel("To", { exact: true }).fill(today);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`from=${newYear}&to=${today}`));

  await page.getByRole("link", { name: "Brands" }).click();
  await expect(page).toHaveURL(/top=brands/);
  await expect(page).toHaveURL(new RegExp(`from=${newYear}`));

  await page.getByRole("link", { name: "Profit" }).click();
  await expect(page).toHaveURL(/sort=profit/);
  await expect(page).toHaveURL(/top=brands/);
});
