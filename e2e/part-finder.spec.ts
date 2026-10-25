import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow.spec.ts (files run in name order), which creates BRK-001.
test("a part is found by a keyword added on the part form", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "admin");

  await page.goto("/parts?q=BRK-001");
  await page.getByRole("link", { name: "BRK-001" }).click();
  await page.getByRole("link", { name: /Edit/ }).click();
  await page.getByLabel("Keywords").fill("liner, LMP-4471");
  await page.getByRole("button", { name: "Save part" }).click();
  await expect(page.getByText("liner, LMP-4471")).toBeVisible();

  await page.goto("/invoices/new");
  await page.getByLabel("Find a part").fill("lmp-4471");
  await expect(page.getByRole("option", { name: /BRK-001/ })).toBeVisible();
});
