import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow (files run in name order), which sells BRK-001 today.
test("admin sees stock health and filters the list", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/stock");

  for (const tile of ["Stock value", "Slow & dead", "Turns per year", "Days of stock"]) {
    await expect(page.getByRole("term").filter({ hasText: new RegExp(`^${tile}$`) })).toBeVisible();
  }
  await expect(page.getByRole("columnheader", { name: "Last sold" })).toBeVisible();

  await page.getByRole("link", { name: /^0–90 days/ }).click();
  await expect(page).toHaveURL(/age=0-90/);
  await expect(page.getByText(/Showing 0–90 days/)).toBeVisible();
  await expect(page.getByRole("link", { name: "BRK-001" })).toBeVisible();

  await page.getByLabel("Search stock").fill("BRK");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/age=0-90/); // the band survives a search

  await page.getByRole("link", { name: /^A · / }).click();
  await expect(page).toHaveURL(/class=A/);
  await page.getByRole("link", { name: "Show all" }).click();
  await expect(page).not.toHaveURL(/age=|class=/);
});

test("staff see the plain stock list", async ({ page }) => {
  await login(page, "staff");
  await page.goto("/stock?age=365%2B&class=A");
  await expect(page.getByRole("term").filter({ hasText: /^Stock value$/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "BRK-001" })).toBeVisible(); // not filtered
});
