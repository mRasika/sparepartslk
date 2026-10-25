import { expect, test } from "@playwright/test";
import { login } from "./users";

const html = (page: import("@playwright/test").Page) => page.locator("html");

test("the theme switch turns the app dark, remembers it and leaves printing light", async ({ page }) => {
  await login(page, "admin");

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(html(page)).toHaveClass(/\bdark\b/);

  await page.reload();
  await expect(html(page)).toHaveClass(/\bdark\b/);

  // full-flow (runs earlier) issued an invoice; its print page stays light.
  await page.goto("/invoices");
  const href = await page.getByRole("link", { name: /^INV-/ }).first().getAttribute("href");
  await page.goto(`/print/invoice/${href!.split("/").pop()}`);
  await expect(html(page)).not.toHaveClass(/\bdark\b/);

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(html(page)).not.toHaveClass(/\bdark\b/);
});
