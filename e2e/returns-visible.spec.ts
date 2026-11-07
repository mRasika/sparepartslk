import { expect, test } from "@playwright/test";
import { login } from "./users";

const colombo = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(at);

// Runs after full-flow (files run in name order), which returns part of today's invoice.
test("today's returns are named on the dashboard and listed with the sale they undo", async ({ page }) => {
  const today = colombo(new Date());
  await login(page, "staff");

  const link = page.getByRole("link", { name: /^1 return Rs [\d,]+$/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(`/returns?from=${today}&to=${today}`);
  await expect(page.getByText(/^1 return on \d{1,2} \w{3}$/)).toBeVisible();
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: /^CRN-/ }) });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("link", { name: /^INV-/ })).toBeVisible();
  await expect(row.getByText(/^sold /)).toBeVisible();

  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page).toHaveURL(/\/returns$/);

  await page.goto("/returns?from=2000-01-01&to=2000-01-02");
  await expect(page.getByText("No returns 1 Jan 2000 – 2 Jan 2000.")).toBeVisible();
});
