import { expect, test } from "@playwright/test";
import { login } from "./users";

test.describe("staff permissions", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "staff");
  });

  test("hides the admin links", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
  });

  test("blocks the settings page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  });

  test("hides sales & profit", async ({ page }) => {
    await page.goto("/dashboard?period=year");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sales & profit" })).toHaveCount(0);
  });

  test("hides the daily target", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.getByText("Daily target")).toHaveCount(0);
    expect((await page.request.get("/api/reports/daily")).status()).toBe(403);
  });

  test("never shows average cost on a part", async ({ page }) => {
    // The full-flow spec creates BRK-001 before this file runs (files run in name order).
    await page.goto("/parts?q=BRK-001");
    await page.getByRole("link", { name: "BRK-001" }).click();
    await expect(page.getByText("On hand")).toBeVisible();
    await expect(page.getByText(/avg cost/i)).toHaveCount(0);
    await expect(page.getByText("Unit cost")).toHaveCount(0);
  });
});
