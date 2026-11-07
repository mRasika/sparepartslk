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

  const term = (name: string) => page.getByRole("term").filter({ hasText: new RegExp(`^${name}$`) });
  // One sentence says what is owed; the rest of the figures wait behind "More figures".
  await expect(page.getByRole("region", { name: "What customers owe" })).toContainText(/Customers owe Rs [\d,.kM]+, from 1 customer\. None of it is late\./);
  await expect(term("Due in next 7 days")).toBeHidden();
  await page.getByText("More figures").click();
  for (const tile of ["Due in next 7 days", "Customers pay after"]) await expect(term(tile)).toBeVisible();

  const who = page.getByRole("region", { name: "Who owes" });
  const nimal = who.getByRole("row").filter({ has: page.getByRole("link", { name: "Nimal Perera" }) });
  await expect(nimal.getByText("On time")).toBeVisible(); // the invoice is dated today, so not due yet

  await page.getByRole("link", { name: /^Not due/ }).click();
  await expect(page).toHaveURL(/late=not-due/);
  await expect(page.getByText(/Showing Not due/)).toBeVisible();

  await page.goto("/payments?view=outstanding&overdue=1&late=not-due");
  await expect(page.getByRole("link", { name: "Overdue only" })).not.toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Show all" }).click();
  await expect(page).not.toHaveURL(/late=/);
});
