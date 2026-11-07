import { expect, test } from "@playwright/test";
import { E2E_SETUP_KEY } from "../setup-db";

// One walk through a brand-new company, in order: the database starts empty (global-setup).
test.describe.configure({ mode: "serial" });

test("a new company is set up once through the browser", async ({ page, context }) => {
  await test.step("the first visit lands on setup, named Sparepartslk until there is a name", async () => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { name: "Set up Sparepartslk" })).toBeVisible();
    await expect(page).toHaveTitle("Set up · Sparepartslk");
  });

  const fill = async (key: string) => {
    await page.getByLabel("Setup key").fill(key);
    await page.getByLabel("Business name").fill("Silva Motors");
    await page.getByLabel("Your name").fill("Kamal Silva");
    await page.getByLabel("Email").fill("Owner@Silva.LK");
    await page.getByLabel("Password", { exact: true }).fill("owner-pass-123");
    await page.getByLabel("Password again").fill("owner-pass-123");
    await page.getByRole("button", { name: "Set up" }).click();
  };

  await test.step("a wrong key is refused", async () => {
    await fill("wrong-key-wrong-key-wrong-key");
    await expect(page.getByText("The setup key is wrong.")).toBeVisible();
  });

  await test.step("the right key sets up the company and signs the owner in", async () => {
    await fill(E2E_SETUP_KEY);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
    await expect(page.getByRole("link", { name: "Silva Motors" })).toBeVisible();
    await expect(page).toHaveTitle("Silva Motors");
  });

  await test.step("setup is closed afterwards", async () => {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/login$|\/dashboard$/);
    await expect(page).not.toHaveURL(/\/setup$/);
  });

  await test.step("signed out, the sign-in page shows the company's name", async () => {
    await context.clearCookies();
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Silva Motors" })).toBeVisible();
    await expect(page).toHaveTitle("Sign in · Silva Motors");
  });
});
