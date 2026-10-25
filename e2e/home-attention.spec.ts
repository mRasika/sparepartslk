import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow (files run in name order): BRK-001 is low and money is owed, none overdue.
test("the dashboard sums up today and lists only what needs attention", async ({ page }) => {
  await login(page, "staff");

  await expect(page.getByText(/sold today/)).toBeVisible();
  await expect(page.getByText("Sales today")).toHaveCount(0);

  const attention = page.getByRole("region", { name: "Needs attention" });
  await expect(attention.getByText(/none of it overdue/)).toBeVisible();
  await expect(attention.getByRole("link")).toHaveCount(1);

  await attention.getByRole("link", { name: /1 part to reorder/ }).click();
  await expect(page).toHaveURL(/\/low-stock$/);
});
