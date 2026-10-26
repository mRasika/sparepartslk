import { expect, test } from "@playwright/test";
import { login } from "./users";

const colombo = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(at);

// Runs after full-flow (files run in name order), which sells well over Rs 1,000 today.
test("admin sets a daily target, sees it hit and downloads the report", async ({ page }) => {
  test.setTimeout(180_000);
  const today = colombo(new Date());
  const tomorrow = colombo(new Date(Date.now() + 86_400_000));
  await login(page, "admin");

  const card = page.getByRole("region", { name: /Daily target/ });
  await expect(card.getByText("No daily target yet.")).toBeVisible();
  await card.getByRole("link", { name: "Set a daily target" }).click();

  await page.getByLabel("Daily target (Rs)").fill("1000");
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Sales target saved")).toBeVisible();
  await expect(page.getByText(/In force since/)).toBeVisible();

  await page.getByLabel("Date", { exact: true }).fill(tomorrow);
  await page.getByLabel("Reason").fill("Vesak Poya");
  await page.getByRole("button", { name: "Add closed date" }).click();
  await expect(page.getByText("Vesak Poya")).toBeVisible();
  await page.getByRole("button", { name: /^Remove / }).click();
  await expect(page.getByText("Vesak Poya")).toHaveCount(0);

  await page.goto("/dashboard");
  await expect(card.getByText(/Hit · Rs [\d,.]+ over/)).toBeVisible();
  await expect(card.getByRole("progressbar", { name: "Today's sales against target" })).toBeVisible();

  // Headless Chrome cancels the click-started download here, so check the link and what it serves.
  const href = await card.getByRole("link", { name: "Download PDF" }).getAttribute("href");
  expect(href).toBe(`/api/reports/daily?date=${today}&download=1`);
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["content-disposition"]).toBe(`attachment; filename=daily-sales-${today}.pdf`);
});
