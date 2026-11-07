import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow (files run in name order), which creates at least one invoice.
test("an uploaded logo shows on Settings and on an invoice's print page", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/settings");
  // The e2e database starts with no business name, and the form requires one.
  await page.getByLabel("Business name").fill("E2E Motors");
  await page.getByLabel("Logo (PNG, JPG or WebP, under 1 MB)").setInputFiles("e2e/fixtures/logo.png");
  await expect(page.getByText("Logo uploaded. Save to keep it.")).toBeVisible();
  const preview = page.getByRole("img", { name: "Current logo" });
  await expect(preview).toHaveAttribute("src", /\/api\/logo\?v=\d+/);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  await page.goto("/invoices");
  await page.locator('main a[href^="/invoices/"]:not([href="/invoices/new"])').first().click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
  const invoiceId = page.url().split("/").at(-1)!;

  await page.goto(`/print/invoice/${invoiceId}?format=a4`);
  const logo = page.locator('img[src*="/api/logo?v="]');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});
