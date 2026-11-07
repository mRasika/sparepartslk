import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_OUTBOX, E2E_USERS, login } from "./users";

const who = E2E_USERS.reset;

/** The newest code emailed to `to` (the e2e server writes emails to the outbox folder). */
async function latestCode(to: string, after: number): Promise<string> {
  let code = "";
  await expect
    .poll(
      () => {
        const files = (() => {
          try {
            return readdirSync(E2E_OUTBOX);
          } catch {
            return [];
          }
        })()
          .filter((f) => f.includes(to) && Number(f.split("-")[0]) >= after)
          .sort();
        const email = files.length ? JSON.parse(readFileSync(path.join(E2E_OUTBOX, files.at(-1)!), "utf8")) : null;
        code = /Your code is (\d{6})/.exec(email?.text ?? "")?.[1] ?? "";
        return code;
      },
      { timeout: 30_000 },
    )
    .toMatch(/^\d{6}$/);
  return code;
}

test("a ticked login resets a forgotten password by email, and old sessions are signed out", async ({ page, browser }) => {
  // Another device already signed in with the old password.
  const other = await (await browser.newContext()).newPage();
  await login(other, "reset");

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);

  const asked = Date.now();
  await page.getByLabel("Email").fill(who.email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("status")).toContainText("If this email can get codes, we sent a 6-digit code");
  const code = await latestCode(who.email, asked);

  const newPassword = "e2e-reset-new-pass";
  await page.getByLabel("6-digit code").fill(code === "000000" ? "111111" : "000000");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("New password again").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("The code is wrong or too old. Ask for a new code.")).toBeVisible();

  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=done$/);
  await expect(page.getByText("Password changed. Sign in with the new one.")).toBeVisible();

  // The other device is signed out.
  await other.goto("/dashboard");
  await expect(other).toHaveURL(/\/login$/);

  // The old password no longer works; the new one does.
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
});

test("an unticked login gets the same answer and no email", async ({ page }) => {
  const asked = Date.now();
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(E2E_USERS.staff.email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("status")).toContainText("If this email can get codes, we sent a 6-digit code");
  await page.waitForTimeout(2000);
  const files = readdirSync(E2E_OUTBOX).filter((f) => f.includes(E2E_USERS.staff.email) && Number(f.split("-")[0]) >= asked);
  expect(files).toHaveLength(0);
});

test("the admin sets a password and ticks who can get emails", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/users");
  const row = page.getByRole("row").filter({ hasText: who.email });
  await expect(row.getByRole("checkbox", { name: `${who.fullName} can get emails` })).toBeChecked();

  await row.getByRole("button", { name: "Set password" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New password").fill("admin-set-pass-1");
  await dialog.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText(`New password set for ${who.fullName}`)).toBeVisible();

  const staffRow = page.getByRole("row").filter({ hasText: E2E_USERS.staff.email });
  const tick = staffRow.getByRole("checkbox", { name: `${E2E_USERS.staff.fullName} can get emails` });
  await expect(tick).not.toBeChecked();
  await tick.click();
  await expect(tick).toBeChecked();
  await tick.click();
  await expect(tick).not.toBeChecked();
});
