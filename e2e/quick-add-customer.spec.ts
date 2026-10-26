import { expect, test } from "@playwright/test";
import { login } from "./users";

// Runs after full-flow (files run in name order), which adds BRK-001.
test("staff add a new customer from the picker and quote them", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "staff");
  await page.goto("/quotations/new");

  // A typed phone number goes to Phone, not Name.
  await page.getByLabel("Customer").fill("0771234567");
  await page.getByRole("option", { name: /Add “0771234567” as a new customer/ }).click();
  const dialog = page.getByRole("dialog", { name: "New customer" });
  await expect(dialog.getByLabel("Phone")).toHaveValue("0771234567");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.getByLabel("Customer").fill("Ruwan Silva");
  await expect(page.getByText("No active customer matches.")).toBeVisible();
  await page.getByRole("option", { name: /Add “Ruwan Silva” as a new customer/ }).click();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Ruwan Silva");
  await dialog.getByLabel("Phone").fill("071 555 0101");
  // Enter adds the customer; it must not reach the quotation form behind the dialog.
  await dialog.getByLabel("Phone").press("Enter");

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/quotations\/new$/);
  await expect(page.getByLabel("Customer")).toHaveValue("Ruwan Silva");
  await expect(page.getByText(/cash only \(no credit limit\)/)).toBeVisible();

  await page.getByLabel("Find a part").fill("BRK-001");
  await page.getByRole("option", { name: /BRK-001/ }).click();
  await page.getByRole("button", { name: "Save quotation" }).click();
  await expect(page.getByRole("heading", { name: /QUO-\d{4}-\d{6}/ })).toBeVisible();
  await expect(page.getByText("Ruwan Silva").first()).toBeVisible();

  // The customer is a real record now.
  await page.goto("/customers?q=Ruwan");
  await expect(page.getByRole("link", { name: "Ruwan Silva" })).toBeVisible();
});
