import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow (files run in name order): Nimal Perera owes on a credit invoice dated today.
test("staff sees who owes and filters the list by how late", async ({ page }) => {
  await login(page, "staff");
  await page.goto("/payments");
  await page.getByRole("link", { name: "Outstanding", exact: true }).click();
  await expect(page).toHaveURL(/view=outstanding/);
  await page.getByRole("link", { name: "Most overdue" }).click();
  await expect(page).toHaveURL(/by=overdue/);
  await expect(page.getByRole("link", { name: "Most overdue" })).toHaveAttribute("aria-current", "page");

  await page.goto("/payments?view=outstanding&late=abc&by=xyz"); // bad params are ignored

  for (const tile of ["Owed", "Overdue", "Due in next 7 days", "Days to collect"]) {
    await expect(page.getByRole("term").filter({ hasText: new RegExp(`^${tile}$`) })).toBeVisible();
  }
  const who = page.getByRole("region", { name: "Who owes" });
  await expect(who.getByRole("link", { name: "Nimal Perera" })).toBeVisible();

  await page.getByRole("link", { name: /^Not due/ }).click();
  await expect(page).toHaveURL(/late=not-due/);
  await expect(page.getByText(/Showing Not due/)).toBeVisible();

  await page.goto("/payments?view=outstanding&overdue=1&late=not-due");
  await expect(page.getByRole("link", { name: "Overdue only" })).not.toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Show all" }).click();
  await expect(page).not.toHaveURL(/late=/);
});
